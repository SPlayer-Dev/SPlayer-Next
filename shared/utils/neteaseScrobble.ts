import type { PlaybackContext, Track, TrackFee } from "../types/player";
import type { NeteaseScrobbleMode } from "../types/settings";

type NeteaseScrobbleSourceType = "song" | "list" | "album" | "artist" | "radio";

export interface NeteaseScrobbleTrack {
  id: string;
  resourceType: "song" | "dj";
  title: string;
  durationSec: number;
  ncbl?: {
    sourceid: string;
    sourceType: NeteaseScrobbleSourceType;
    artist: string;
    bitrate: number;
    level: string;
    fee: TrackFee;
  };
}

/**
 * 按协议提取日志元数据，网页模式不保留桌面协议的额外字段
 * @param track - 当前播放曲目
 * @param context - 播放来源上下文
 * @param durationMs - 引擎确认后的时长
 * @param mode - 上报协议，默认为网页日志
 * @returns 平台资源的轻量日志信息，其余来源返回 null
 */
export const toNeteaseScrobbleTrack = (
  track: Track | null,
  context: PlaybackContext | undefined,
  durationMs: number,
  mode: NeteaseScrobbleMode = "legacy",
): NeteaseScrobbleTrack | null => {
  if (!track || track.source !== "netease" || !/^[1-9]\d*$/.test(track.id)) return null;
  const voiceId = track.extId && /^[1-9]\d*$/.test(track.extId) ? track.extId : undefined;
  const meta: NeteaseScrobbleTrack = {
    id: voiceId ?? track.id,
    resourceType: voiceId ? "dj" : "song",
    title: track.title,
    durationSec: Math.round(durationMs / 1000),
  };
  if (mode !== "ncbl") return meta;

  const neteaseContext =
    context?.provider === "netease" && context.originType !== "page" ? context : undefined;
  const contextId = neteaseContext?.originId;
  const sourceId = contextId && /^[1-9]\d*$/.test(contextId) ? contextId : undefined;
  const radioId = track.album?.id;
  const bitrate = track.quality?.bitRate ?? 320;
  let sourceType: NeteaseScrobbleSourceType = "song";
  if (voiceId) sourceType = "radio";
  else if (sourceId) {
    const origin = neteaseContext?.originType;
    if (origin === "playlist") sourceType = "list";
    else if (origin === "album" || origin === "artist" || origin === "radio") sourceType = origin;
  }
  return {
    ...meta,
    ncbl: {
      sourceid:
        sourceId ??
        (voiceId && radioId && /^[1-9]\d*$/.test(radioId) ? radioId : undefined) ??
        meta.id,
      sourceType,
      artist: track.artists.map((artist) => artist.name).join(" / "),
      bitrate: bitrate > 10000 ? Math.round(bitrate / 1000) : Math.round(bitrate),
      level:
        track.quality?.codec?.toLowerCase() === "flac"
          ? "lossless"
          : bitrate >= 320000
            ? "exhigh"
            : "higher",
      fee: track.fee ?? 0,
    },
  };
};
