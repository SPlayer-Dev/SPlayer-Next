import type { Track } from "@shared/types/player";
import { useStreamingStore } from "@/stores/streaming";
import { useSettingsStore } from "@/stores/settings";
import { handleError } from "@/utils/errors";

/** 解析结果：source 是喂给 audio-engine 的字符串；fromCache 命中本地缓存时为 true */
export interface ResolvedSource {
  source: string;
  fromCache: boolean;
}

/** 派生缓存键；返回 null 表示该 track 不参与歌曲缓存 */
const cacheKeyForTrack = (track: Track): string | null => {
  if (track.source === "streaming" && track.serverId && track.originalId) {
    return `s:${track.serverId}:${track.originalId}:`;
  }
  // 待 online 平台接入：return `o:${track.platform}:${track.originalId}:`;
  return null;
};

/** 把 Track 解析成可喂给 audio-engine 的 source 字符串 */
export const resolveTrackSource = async (track: Track): Promise<ResolvedSource | null> => {
  if (track.source === "local") {
    return track.path ? { source: track.path, fromCache: false } : null;
  }

  const settings = useSettingsStore();
  const cacheKey = cacheKeyForTrack(track);
  const cacheEnabled = settings.system.cache?.songCache?.enabled === true && cacheKey !== null;

  if (cacheEnabled) {
    const cached = await window.api.songCache.lookup(cacheKey!);
    if (cached) return { source: cached, fromCache: true };
  }

  if (track.source === "streaming") {
    try {
      const streamUrl = await useStreamingStore().getStreamUrl(track);
      if (cacheEnabled) void window.api.songCache.fetch(cacheKey!, "streaming", streamUrl);
      return { source: streamUrl, fromCache: false };
    } catch (err) {
      handleError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  // online 平台真正接入时在此加分支：拿 URL 后同样走 fetch(cacheKey, "online", url)
  return null;
};
