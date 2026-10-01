import type { PlaybackContext, Track } from "@shared/types/player";
import type { NeteaseScrobbleMode } from "@shared/types/settings";
import {
  neteaseScrobbleThresholdMs,
  toNeteaseScrobbleTrack,
  type NeteaseScrobbleTrack,
} from "@shared/utils/neteaseScrobble";
import { store } from "@main/store";
import { callNetease, getNeteaseCookies } from "@main/apis/netease";
import { neteaseLog } from "@main/utils/logger";
import { createPlayProgress } from "@main/services/playProgress";

/** 退出前等待补发请求完成的最长时间；超时则放弃，不阻塞退出 */
const QUIT_FLUSH_MAX_WAIT_MS = 2000;

let current: NeteaseScrobbleTrack | null = null;
/** 上一次收到的源时间位置 */
let lastPositionMs = 0;
/** 当前播放轮次，用于丢弃旧请求回包 */
let cycleId = 0;
/** 最近一次结算发出的请求，退出前用它等待补发完成 */
let settleRequest: Promise<void> | null = null;

/** 是否看起来是网易云登录态 */
const isLoggedIn = (): boolean => Boolean(getNeteaseCookies().MUSIC_U);

/** 听歌打卡是否启用 */
const isScrobbleEnabled = (): boolean => Boolean(store.get("system.neteaseScrobbleEnabled"));

/** 当前配置启用的上报接口 */
const scrobbleApi = (): string => {
  const mode = (store.get("system.neteaseScrobbleMode") || "ncbl") as NeteaseScrobbleMode;
  return mode === "ncbl" ? "scrobble_v1" : "scrobble";
};

/** 检查接口业务码 */
const ensureScrobbleOk = (api: string, res: { body: any }): void => {
  if (res.body?.code === 200 || res.body?.data === "success") return;
  const msg = res.body?.msg || res.body?.message || JSON.stringify(res.body);
  throw new Error(`${api}: ${msg}`);
};

/** 提交一次打卡（登录态由调用方判定，关着开关由 shouldFire 拦截） */
const submit = (track: NeteaseScrobbleTrack, playedMs: number): Promise<void> => {
  const requestCycleId = cycleId;
  const playedSec = Math.max(1, Math.min(track.durationSec, Math.round(playedMs / 1000)));
  const api = scrobbleApi();
  return callNetease(api, {
    id: track.id,
    sourceid: track.sourceId,
    source: track.sourceType,
    sourceType: track.sourceType,
    resourceType: track.resourceType,
    time: playedSec,
    total: track.durationSec,
    name: track.title,
    artist: track.artist,
    bitrate: track.bitrate,
    level: track.level,
    fee: track.fee,
  })
    .then((res) => {
      ensureScrobbleOk(api, res);
      if (requestCycleId === cycleId)
        neteaseLog.debug(`听歌打卡(${api}): ${track.title} ${playedSec}s`);
    })
    .catch((err) => {
      if (requestCycleId === cycleId) neteaseLog.warn(`听歌打卡失败(${api}):`, err);
    });
};

/**
 * 把「何时算听过一次」与「上报多少时长」拆开
 *
 * - onThreshold 仍在达标瞬间触发：只登记曲目，本轮计数成立（与 Last.fm 时序一致）
 * - 时长要等本轮结束才知道，故统一放到 onSettle 用本轮最终累计时长上报
 */
const progress = createPlayProgress<NeteaseScrobbleTrack>({
  onThreshold: (track, playedMs) => {
    neteaseLog.info(
      `听歌打卡达标: ${track.title} ${Math.round(playedMs / 1000)}s/${track.durationSec}s，等待本轮结算`,
    );
  },
  onSettle: (track, playedMs, fired) => {
    // 未达标的轮次不构成一次有效收听，不上报
    if (!fired) {
      neteaseLog.debug(
        `听歌打卡未达阈值，本轮不上报: ${track.title} ${Math.round(playedMs / 1000)}s/${track.durationSec}s`,
      );
      return;
    }
    if (!isLoggedIn()) {
      neteaseLog.debug(`未登录网易云，跳过听歌打卡: ${track.title}`);
      return;
    }
    settleRequest = submit(track, playedMs);
  },
  shouldFire: isScrobbleEnabled,
  thresholdMs: neteaseScrobbleThresholdMs,
});

/**
 * 新曲目加载
 * @param track - 渲染层下发的权威 Track
 * @param context - 本次播放的来源上下文
 * @param durationMs - 引擎确认后的时长
 * @param autoPlay - 是否自动播放
 */
export const onTrackLoaded = (
  track: Track | null,
  context: PlaybackContext | undefined,
  durationMs: number,
  autoPlay: boolean,
): void => {
  cycleId++;
  current = toNeteaseScrobbleTrack(track, context, durationMs);
  progress.load(current?.durationSec ?? 0, current, autoPlay);
  lastPositionMs = 0;
};

/**
 * 播放/暂停状态变化
 * @param playing - 是否正在播放
 */
export const onState = (playing: boolean): void => {
  progress.setPlaying(playing);
};

/**
 * 播放进度推进
 * @param positionMs - 当前源时间位置
 */
export const onPosition = (positionMs: number): void => {
  // 已打卡后若用户跳回阈值之前，视为重新收听，重置本轮计时以便再次打卡
  if (current && progress.hasFired()) {
    const limit = progress.thresholdMs();
    const returnedBeforeThreshold = lastPositionMs >= limit && positionMs < limit;
    const jumpedBack = positionMs + 1000 < lastPositionMs;
    if (positionMs < limit && (returnedBeforeThreshold || jumpedBack)) {
      cycleId++;
      // 先把本轮已达标的一次按当前时长结算上报，再开始新一轮计时
      void flush();
      progress.rearm();
    }
  }
  lastPositionMs = positionMs;
  progress.tick();
};

/** 自然播放结束 */
export const onEnded = (): void => {
  cycleId++;
  progress.end();
  current = null;
  lastPositionMs = 0;
};

/**
 * 结算当前轮次并补发挂起的打卡
 *
 * 用于「达标后还没到自然结算点就退出」的补报，避免整轮记录丢失。
 * @returns 本次补发的请求（最多等待 QUIT_FLUSH_MAX_WAIT_MS）；没有待补发内容时为 null
 */
export const flush = (): Promise<void> | null => {
  settleRequest = null;
  progress.flush();
  const request = settleRequest;
  settleRequest = null;
  if (!request) return null;
  return Promise.race([
    request,
    new Promise<void>((resolve) => setTimeout(resolve, QUIT_FLUSH_MAX_WAIT_MS)),
  ]);
};
