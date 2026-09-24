import { getPlayer, onPlayerReset } from "@main/services/engine";
import * as songCache from "@main/services/songCache";
import { playerLog } from "@main/utils/logger";
import type { TransitionPreference } from "@shared/types/player";
import { TRANSITION_LOOKAHEAD_MS } from "@shared/constants/playback";

let prepared: {
  id: string;
  player: ReturnType<typeof getPlayer>;
  ready: boolean;
  preference?: TransitionPreference;
} | null = null;
let notifiedId: string | null = null;
let currentRange: { startMs: number; endMs: number; analyzed: boolean; tailEndMs?: number } | null =
  null;

/**
 * 只保留当前曲目的尾部判定，加载和停止时清空。
 * @param startMs - 曲目或 CUE 分轨起点，省略时清空
 * @param endMs - 曲目或 CUE 分轨终点
 */
export const setCurrentTransitionRange = (startMs?: number, endMs?: number): void => {
  currentRange = startMs != null && endMs != null ? { startMs, endMs, analyzed: false } : null;
};

/**
 * 返回当前曲目确认的交接终点，播放进度和媒体时长仍使用原始值。
 * @param fallbackMs - 原始终点
 * @param positionMs - 当前源时间
 * @param speed - 播放倍速
 * @returns 包含交接余量的源时间终点
 */
export const getTransitionEndMs = (fallbackMs: number, positionMs = 0, speed = 1): number => {
  if (currentRange?.tailEndMs == null) return fallbackMs;
  // 分析完成时可能已经进入静音，仍留出短暂交接时间，避免错过提前切换。
  return Math.min(
    Math.max(currentRange.tailEndMs, positionMs + 1500 * Math.max(1, speed)),
    fallbackMs,
  );
};

/**
 * 曲尾只通知一次就绪槽位，隐藏窗口也能安排交接
 * @param remainingMs - 当前曲目剩余的源时间
 * @param speed - 当前播放倍速，用于转换成墙钟时间
 * @returns 尚未通知的就绪槽位标识
 */
export const takeTransitionReady = (remainingMs: number, speed = 1): string | null => {
  const remainingWallMs = remainingMs / speed;
  const lookahead = TRANSITION_LOOKAHEAD_MS[prepared?.preference ?? "standard"];
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
 * @returns 当前任务仍有效且音频已准备就绪时返回 true，否则返回 false
 */
export const prepareNextTrack = async (
  id: string,
  source: string,
  startMs = 0,
  preference?: TransitionPreference,
): Promise<boolean> => {
  cancelPreparedTrack();
  const player = getPlayer();
  prepared = { id, player, ready: false, preference };
  songCache.pinPreload(id, source);
  try {
    const ready = await player.prepareNext(id, source, startMs / 1000);
    if (!ready || prepared?.id !== id) {
      player.cancelPrepared(id);
      cancelPreparedTrack(id);
      return false;
    }
    prepared.ready = true;
    const range = currentRange;
    if (preference && range && !range.analyzed) {
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
