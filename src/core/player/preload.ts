import type { Track } from "@shared/types/player";
import type { ResolvedTrackSource } from "@/services/audioSource";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import * as queue from "@/stores/queue";
import { resolveTrackSource } from "@/services/audioSource";

export interface NextTrackCandidate {
  track: Track;
  index: number;
}

export interface PreloadedTrack extends NextTrackCandidate {
  source: string;
  resolved: ResolvedTrackSource;
  key: string;
}

let active: PreloadedTrack | null = null;
let inFlight: Promise<PreloadedTrack | null> | null = null;
let inFlightKey: string | null = null;
let token = 0;

const candidateKey = (candidate: NextTrackCandidate): string => {
  const settings = useSettingsStore();
  return [
    candidate.track.id,
    candidate.index,
    settings.player.songLevel,
    candidate.track.source,
    candidate.track.serverId ?? "",
  ].join("|");
};

const triggerCacheDownload = (request: () => Promise<string | null>): void => {
  void request().catch((err) => {
    console.warn("[preload] cache download failed", err);
  });
};

/** 计算当前播放状态下的下一首候选 */
export const getNextTrackCandidate = (): NextTrackCandidate | null => {
  const status = useStatusStore();
  if (status.fmMode) return null;
  const len = queue.queueLength.value;
  if (len === 0 || status.playIndex < 0) return null;
  if (status.repeatMode === "one") {
    const track = queue.getTrack(status.playIndex);
    return track ? { track, index: status.playIndex } : null;
  }
  const nextIndex =
    status.playIndex >= len - 1 ? (status.repeatMode === "list" ? 0 : -1) : status.playIndex + 1;
  if (nextIndex < 0) return null;
  const track = queue.getTrack(nextIndex);
  return track ? { track, index: nextIndex } : null;
};

/** 取当前仍有效的预载候选 */
export const getPreloadedTrack = (): PreloadedTrack | null => {
  const candidate = getNextTrackCandidate();
  if (!candidate || !active) return null;
  return active.key === candidateKey(candidate) ? active : null;
};

/** 取消渲染调度与 native prepared slot */
export const cancelPreload = (): void => {
  token++;
  active = null;
  inFlight = null;
  inFlightKey = null;
  void window.api.player.cancelPreload();
};

/**
 * 预载当前队列的下一首。
 * @returns 已解析且 native 预载成功的候选；取消、关闭或失败时返回 null
 */
export const preloadNextTrack = async (): Promise<PreloadedTrack | null> => {
  const settings = useSettingsStore();
  if (!settings.system.player.preloadNext && !settings.system.player.automixEnabled) {
    cancelPreload();
    return null;
  }
  const candidate = getNextTrackCandidate();
  if (!candidate) {
    cancelPreload();
    return null;
  }
  const key = candidateKey(candidate);
  if (active?.key === key) return active;
  if (inFlight && inFlightKey === key) return inFlight;

  const myToken = ++token;
  inFlightKey = key;
  inFlight = (async () => {
    const resolved = await resolveTrackSource(candidate.track);
    if (myToken !== token || !resolved) return null;
    if (resolved.cacheRequest) {
      triggerCacheDownload(resolved.cacheRequest);
    }
    const preloadSource = resolved.source;
    const result = await window.api.player.preload(preloadSource);
    if (myToken !== token || !result.success) return null;
    const prepared: PreloadedTrack = {
      ...candidate,
      source: preloadSource,
      resolved: {
        ...resolved,
        source: preloadSource,
        fromCache: resolved.fromCache || preloadSource !== resolved.source,
      },
      key,
    };
    active = prepared;
    return prepared;
  })().finally(() => {
    if (inFlightKey === key) {
      inFlight = null;
      inFlightKey = null;
    }
  });
  return inFlight;
};
