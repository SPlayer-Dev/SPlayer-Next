import type { PlaybackContext, PlaybackOriginType, Track, TrackFee } from "../types/player";

export type NeteaseScrobbleSourceType = "song" | "list" | "album" | "artist" | "radio";

export interface NeteaseScrobbleTrack {
  id: string;
  sourceId: string;
  sourceType: NeteaseScrobbleSourceType;
  resourceType: "song" | "dj";
  title: string;
  artist: string;
  bitrate: number;
  level: string;
  fee: TrackFee;
  durationSec: number;
}

/**
 * 计算网易云听歌打卡阈值，短音频同样在播放过半后上报
 * @param durationSec - 音频总时长（秒）
 * @returns 触发上报所需的累计播放毫秒数
 */
export const neteaseScrobbleThresholdMs = (durationSec: number): number =>
  durationSec > 0 ? Math.min(durationSec / 2, 240) * 1000 : Infinity;

const asNumericId = (value: string | undefined): string | null =>
  value && /^\d+$/.test(value) ? value : null;

const toBitrate = (track: Track): number => {
  const bitRate = track.quality?.bitRate ?? 320;
  return bitRate > 10000 ? Math.round(bitRate / 1000) : Math.round(bitRate);
};

const toLevel = (track: Track): string => {
  if (track.quality?.codec?.toLowerCase() === "flac") return "lossless";
  if ((track.quality?.bitRate ?? 0) >= 320000) return "exhigh";
  return "higher";
};

const toNeteaseSourceType = (type: PlaybackOriginType): NeteaseScrobbleSourceType => {
  if (type === "track") return "song";
  if (type === "playlist") return "list";
  if (type === "album" || type === "artist" || type === "radio") return type;
  return "song";
};

/**
 * 从播放曲目生成网易云打卡元数据
 * @param track - 当前播放曲目
 * @param context - 本次播放的来源上下文
 * @param durationMs - 引擎确认后的时长
 * @returns 网易云曲目返回打卡元数据，其余来源返回 null
 */
export const toNeteaseScrobbleTrack = (
  track: Track | null,
  context: PlaybackContext | undefined,
  durationMs: number,
): NeteaseScrobbleTrack | null => {
  if (!track || track.source !== "netease") return null;
  const trackId = asNumericId(track.id);
  if (!trackId) return null;
  const voiceId = asNumericId(track.extId);
  const id = voiceId ?? trackId;
  const neteaseContext =
    context?.provider === "netease" && context.originType !== "page" ? context : undefined;
  const contextId = asNumericId(neteaseContext?.originId);
  const radioId = asNumericId(track.album?.id);
  return {
    id,
    sourceId: contextId ?? (voiceId ? radioId : null) ?? id,
    sourceType: voiceId
      ? "radio"
      : contextId
        ? toNeteaseSourceType(neteaseContext?.originType ?? "track")
        : "song",
    resourceType: voiceId ? "dj" : "song",
    title: track.title,
    artist: track.artists.map((artist) => artist.name).join(" / "),
    bitrate: toBitrate(track),
    level: toLevel(track),
    fee: track.fee ?? 0,
    durationSec: Math.round(durationMs / 1000),
  };
};
