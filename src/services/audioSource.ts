import type { Track } from "@shared/types/player";
import { useStreamingStore } from "@/stores/streaming";
import { useSettingsStore } from "@/stores/settings";
import { handleError } from "@/utils/errors";

/** 派生缓存键；返回 null 表示该 track 不参与歌曲缓存 */
const cacheKeyForTrack = (track: Track): string | null => {
  if (track.source === "streaming" && track.serverId && track.originalId) {
    return `s:${track.serverId}:${track.originalId}:`;
  }
  // 待 online 平台接入：return `o:${track.platform}:${track.originalId}:`;
  return null;
};

/**
 * 根据 track 信息解析出最终的音频源 URL
 * @param track 要解析的 track 对象
 */
export const resolveTrackSource = async (
  track: Track,
): Promise<{
  source: string;
  fromCache: boolean;
} | null> => {
  // 本地文件
  if (track.source === "local") {
    return track.path ? { source: track.path, fromCache: false } : null;
  }
  const settings = useSettingsStore();
  const cacheKey = cacheKeyForTrack(track);
  const cacheEnabled = settings.system.cache?.songCache?.enabled === true && cacheKey !== null;
  if (cacheEnabled) {
    const cached = await window.api.cache.song.lookup(cacheKey!);
    if (cached) return { source: cached, fromCache: true };
  }
  // 流媒体
  if (track.source === "streaming") {
    try {
      const streamUrl = await useStreamingStore().getStreamUrl(track);
      if (cacheEnabled) void window.api.cache.song.fetch(cacheKey!, "streaming", streamUrl);
      return { source: streamUrl, fromCache: false };
    } catch (err) {
      handleError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }
  // TODO: online 平台接入
  return null;
};
