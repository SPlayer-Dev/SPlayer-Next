import type { Track } from "@shared/types/player";
import type { LyricMatchResult } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";

/**
 * 向指定平台请求歌词
 * @param platform - 目标平台
 * @param track - 歌曲信息
 * @returns 在线歌词，不存在则返回 null
 */
export const requestPlatformLyric = async (
  platform: Platform,
  track: Track,
): Promise<LyricMatchResult | null> => {
  const byId = track.source === platform;
  // QM lyric 接口要数字 songID
  const lookupId = platform === "qqmusic" ? (track.extId ?? track.id) : track.id;
  const resp = byId
    ? await window.api.lyrics.matchById(platform, lookupId)
    : await window.api.lyrics.matchByQuery(platform, track);
  return resp.ok && resp.data ? resp.data : null;
};

/**
 * 从流媒体服务器请求歌词
 * @param track - 歌曲信息
 * @returns 服务端歌词，不存在则返回 null
 */
export const requestStreamingLyric = async (track: Track): Promise<string | null> => {
  if (track.source !== "streaming" || !track.serverId || !track.originalId) return null;
  try {
    return await window.api.streaming.getLyrics(track.serverId, track.originalId, {
      artist: track.artists[0]?.name,
      title: track.title,
    });
  } catch (err) {
    console.warn("[streaming] getLyrics failed:", err);
    return null;
  }
};

/**
 * 请求指定平台的 TTML 覆盖歌词
 * @param track - 歌曲信息
 * @param platform - 目标平台
 * @returns IPC 请求结果
 */
export const requestTTMLOverlay = (track: Track, platform: "netease" | "qqmusic") =>
  window.api.lyrics.fetchTTMLOverlay(track, platform);
