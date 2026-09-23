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

let current: NeteaseScrobbleTrack | null = null;
/** 上一次收到的源时间位置 */
let lastPositionMs = 0;
/** 当前播放轮次，用于丢弃旧请求回包 */
let cycleId = 0;

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

/** 达标提交一次打卡（登录态判定在此，关着开关由 shouldFire 拦截） */
const submit = (track: NeteaseScrobbleTrack, playedMs: number): void => {
  if (!isLoggedIn()) return;
  const requestCycleId = cycleId;
  const playedSec = Math.max(1, Math.min(track.durationSec, Math.round(playedMs / 1000)));
  const api = scrobbleApi();
  callNetease(api, {
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
      if (requestCycleId === cycleId) neteaseLog.debug(`听歌打卡(${api}): ${track.title}`);
    })
    .catch((err) => {
      if (requestCycleId === cycleId) neteaseLog.warn(`听歌打卡失败(${api}):`, err);
    });
};

const progress = createPlayProgress<NeteaseScrobbleTrack>({
  onThreshold: submit,
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
