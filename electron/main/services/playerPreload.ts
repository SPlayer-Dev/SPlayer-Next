import { getPlayer, onPlayerReset } from "@main/services/engine";
import * as songCache from "@main/services/songCache";
import { playerLog } from "@main/utils/logger";
import type { TransitionPreference } from "@shared/types/player";
import {
  AUTOMIX_ARM_LEAD_MS,
  AUTOMIX_LOOKAHEAD_MS,
  TRANSITION_LOOKAHEAD_MS,
} from "@shared/constants/playback";
import type { AutoMixPlan, AutoMixPrepareOptions } from "@shared/types/automix";
import { canAutoMix, planAutoMix, planAutoMixBridge } from "./automix/planner";
import { analyzeAutoMixTracks } from "./automix/analysisHost";
import { enhanceAutoMixPlan } from "./automix/enhancement";

let prepared: {
  id: string;
  player: ReturnType<typeof getPlayer>;
  ready: boolean;
  preference?: TransitionPreference;
  automix?: AutoMixPlan;
  /** 槽位取消、曲目范围变化和播放器重建都会终止该信号 */
  analysis: AbortController;
} | null = null;
let notifiedId: string | null = null;
let currentRange: {
  startMs: number;
  endMs: number;
  source?: string;
  analyzed: boolean;
  tailEndMs?: number;
} | null = null;

/**
 * 只保留当前曲目的尾部判定，加载和停止时清空
 * @param startMs - 曲目或 CUE 分轨起点，省略时清空
 * @param endMs - 曲目或 CUE 分轨终点
 * @param source - 当前曲目的实际本地或完整缓存音源
 */
export const setCurrentTransitionRange = (
  startMs?: number,
  endMs?: number,
  source?: string,
): void => {
  prepared?.analysis.abort();
  currentRange =
    startMs != null && endMs != null ? { startMs, endMs, source, analyzed: false } : null;
};

/**
 * 获取仍属于当前备用槽位的自动混音计划
 * @param id - 备用槽位标识
 * @returns 已完成分析的计划
 */
export const getPreparedAutoMixPlan = (id: string): AutoMixPlan | undefined =>
  prepared?.id === id && !prepared.analysis.signal.aborted ? prepared.automix : undefined;

/**
 * 在提交交接前绑定当前解码会话，跳转进度后也能沿用已分析的声部
 * @param id - 就绪的下一曲标识
 * @returns 槽位与音源仍有效且声部已安装时为 true
 */
export const installPreparedAutoMixStems = async (id: string): Promise<boolean> => {
  const task = prepared;
  const stemWindow = task?.automix?.stems.outgoing;
  const source = currentRange?.source;
  if (!task || task.id !== id || task.analysis.signal.aborted || !stemWindow || !source)
    return false;
  const installed = await task.player.installAutoMixStems(id, source, {
    path: stemWindow.path,
    startSeconds: stemWindow.startMs / 1000,
    frames: stemWindow.frames,
  });
  return installed && !task.analysis.signal.aborted;
};

/**
 * 返回当前曲目确认的交接终点，播放进度和媒体时长仍使用原始值
 * @param fallbackMs - 原始终点
 * @param positionMs - 当前源时间
 * @param speed - 播放倍速
 * @returns 包含交接余量的源时间终点
 */
export const getTransitionEndMs = (fallbackMs: number, positionMs = 0, speed = 1): number => {
  if (currentRange?.tailEndMs == null) return fallbackMs;
  // 分析完成时可能已经进入静音，仍留出短暂交接时间，避免错过提前切换
  return Math.min(
    Math.max(currentRange.tailEndMs, positionMs + 1500 * Math.max(1, speed)),
    fallbackMs,
  );
};

/**
 * 曲尾只通知一次就绪槽位，隐藏窗口也能安排交接
 * @param remainingMs - 当前曲目剩余的源时间
 * @param speed - 当前播放倍速，用于转换成墙钟时间
 * @param pitch - 当前用户音调，AutoMix 仅允许原始音调
 * @returns 尚未通知的就绪槽位标识
 */
export const takeTransitionReady = (remainingMs: number, speed = 1, pitch = 0): string | null => {
  if (prepared?.automix && !canAutoMix(speed, pitch)) return null;
  const remainingWallMs = remainingMs / speed;
  const lookahead = prepared?.automix
    ? Math.min(
        AUTOMIX_LOOKAHEAD_MS,
        (currentRange?.endMs ?? 0) - prepared.automix.outStartMs + AUTOMIX_ARM_LEAD_MS,
      )
    : TRANSITION_LOOKAHEAD_MS[prepared?.preference ?? "standard"];
  if (remainingWallMs > lookahead) notifiedId = null;
  if (remainingWallMs < 1000 || remainingWallMs > lookahead || !prepared?.ready) return null;
  if (notifiedId === prepared.id) return null;
  notifiedId = prepared.id;
  return prepared.id;
};

/**
 * 取消下一曲准备任务并释放对应的缓存租约
 * @param id - 预载任务标识，省略时取消当前备用槽位
 */
export const cancelPreparedTrack = (id = prepared?.id): void => {
  if (!id) return;
  const current = prepared?.id === id ? prepared : null;
  current?.analysis.abort();
  if (current) prepared = null;
  try {
    current?.player.cancelPrepared(id);
  } finally {
    songCache.cancelPreload(id);
  }
};

onPlayerReset(cancelPreparedTrack);

/**
 * 将本地或缓存完成的音源交给原生备用槽位解码
 * @param id - 用于取消和消费预载资源的任务标识
 * @param source - 本地音频文件或已完成下载的缓存文件路径
 * @param startMs - 预载起点，单位为毫秒，CUE 子曲目使用对应的起始位置
 * @param preference - 交接偏好，省略时不分析曲尾
 * @param options - 过渡模式和下一曲的有效结束范围
 * @returns 当前任务仍有效且音频已准备就绪时返回 true，否则返回 false
 */
export const prepareNextTrack = async (
  id: string,
  source: string,
  startMs = 0,
  preference?: TransitionPreference,
  options?: AutoMixPrepareOptions,
): Promise<boolean> => {
  cancelPreparedTrack();
  const player = getPlayer();
  const task = {
    id,
    player,
    ready: false,
    preference,
    analysis: new AbortController(),
    automix: undefined as AutoMixPlan | undefined,
  };
  prepared = task;
  songCache.pinPreload(id, source);
  try {
    const range = currentRange;
    if (
      options?.mode === "automix" &&
      range?.source &&
      canAutoMix(player.getSpeed(), player.getPitch())
    ) {
      const tracks = [
        { source: range.source, startMs: range.startMs, endMs: range.endMs, tail: true },
        { source, startMs, endMs: options.endMs, tail: false },
      ];
      const profiles = await analyzeAutoMixTracks(tracks, task.analysis.signal).catch((error) => {
        if (!task.analysis.signal.aborted) playerLog.warn("AutoMix 分析不可用", error);
        return null;
      });
      if (task.analysis.signal.aborted) return false;
      if (profiles) {
        const synced = planAutoMix(profiles[0], profiles[1], range.endMs);
        const candidate = synced ?? planAutoMixBridge(profiles[0], profiles[1], range.endMs);
        if (!synced)
          playerLog.info(
            candidate
              ? "AutoMix 两曲节奏无法对齐，改用原速桥接"
              : "AutoMix 无法对拍也无法桥接，不做混音",
          );
        if (candidate) {
          task.automix = await enhanceAutoMixPlan(
            candidate,
            tracks,
            profiles,
            range.endMs,
            task.analysis.signal,
          ).catch((error) => {
            if (!task.analysis.signal.aborted) playerLog.warn("AutoMix 分轨编排不可用", error);
            return undefined;
          });
          if (task.automix && !task.analysis.signal.aborted) {
            const { strategy, durationMs, outStartMs, inStartMs, outgoingRate } = task.automix;
            playerLog.info(
              `AutoMix 就绪：${strategy === "bridge" ? "原速桥接" : "对拍"} · ${(durationMs / 1000).toFixed(1)} 秒`,
              { outStartMs, inStartMs, outgoingRate },
            );
          }
        }
      }
    }
    if (task.analysis.signal.aborted) return false;
    if (options?.mode === "automix" && !task.automix)
      playerLog.info("AutoMix 本次不可用，按设置交叉过渡或直接切歌");
    const plan = task.automix;
    const ready = plan
      ? await player.prepareNext(id, source, plan.inStartMs / 1000, {
          path: plan.stems.incoming.path,
          startSeconds: plan.stems.incoming.startMs / 1000,
          frames: plan.stems.incoming.frames,
        })
      : await player.prepareNext(id, source, startMs / 1000);
    if (!ready || task.analysis.signal.aborted) {
      player.cancelPrepared(id);
      cancelPreparedTrack(id);
      return false;
    }
    task.ready = true;
    if (!task.automix && preference && range && !range.analyzed) {
      range.analyzed = true;
      const began = performance.now();
      void player
        .analyzeTail(range.startMs / 1000, range.endMs / 1000)
        .then((end) => {
          if (currentRange !== range || end == null) return;
          range.tailEndMs = end * 1000;
          playerLog.info("识别到连续近静音拖尾", {
            trimmedMs: Math.round(range.endMs - range.tailEndMs),
            analysisMs: Math.round(performance.now() - began),
          });
        })
        .catch((error) => {
          if (currentRange === range) playerLog.warn("曲尾分析失败，沿用原始结束位置", error);
        });
    }
    playerLog.info("下一曲 PCM 预载完成", { id, source });
    return true;
  } catch (error) {
    const current = prepared?.id === id;
    cancelPreparedTrack(id);
    if (current) await songCache.invalidate(source);
    throw error;
  }
};
