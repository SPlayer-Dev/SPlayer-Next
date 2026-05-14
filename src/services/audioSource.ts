import type { Track } from "@shared/types/player";
import { useStreamingStore } from "@/stores/streaming";
import { useSettingsStore } from "@/stores/settings";
import { usePluginsStore } from "@/stores/plugins";
import { resolveNeteaseUrl } from "@/apis/url/netease";
import { ErrorCode } from "@shared/types/errors";
import { handleError } from "@/utils/errors";

/** Track.platform → 插件 source key */
const PLATFORM_TO_PLUGIN_SOURCE: Record<string, string> = {
  netease: "wy",
  qqmusic: "tx",
  kugou: "kg",
};

/**
 * 派生缓存键
 * @param track - 要解析的 track
 * @returns 派生缓存键，如果该 track 不参与歌曲缓存则返回 null
 */
const cacheKeyForTrack = (track: Track): string | null => {
  if (track.source === "streaming" && track.serverId && track.originalId) {
    return `s:${track.serverId}:${track.originalId}:`;
  }
  if (track.source === "online" && track.platform && track.id) {
    return `o:${track.platform}:${track.id}:`;
  }
  return null;
};

/**
 * 根据 track 信息解析出最终的音频源 URL
 * @param track - 要解析的 track
 * @returns 解析出的音频源 URL，如果无法解析则返回 null
 */
const resolveByPlugin = async (track: Track): Promise<string | null> => {
  if (!track.platform) return null;
  const pluginSource = PLATFORM_TO_PLUGIN_SOURCE[track.platform];
  if (!pluginSource) return null;
  const plugins = usePluginsStore();
  const found = plugins.list.find(
    (info) =>
      info.enabled &&
      info.status.state === "ready" &&
      info.status.sources[pluginSource]?.actions.includes("musicUrl"),
  );
  if (!found) {
    handleError(ErrorCode.NO_PLUGIN_AVAILABLE);
    return null;
  }
  const res = await window.api.plugins.resolveUrl({
    pluginId: found.manifest.id,
    source: pluginSource,
    quality: "hq",
    musicInfo: {
      songmid: track.id,
      name: track.title,
      singer: track.artists.map((artist) => artist.name).join("/"),
    },
  });
  return res?.url || null;
};

/**
 * 解析在线音频源 URL
 * @param track - 要解析的 track
 */
const resolveOnlineUrl = async (track: Track): Promise<string | null> => {
  try {
    if (track.platform === "netease") {
      const url = await resolveNeteaseUrl(track);
      if (url) return url;
    }
  } catch {
    // 官方 API 异常回落插件
  }
  return resolveByPlugin(track);
};

/**
 * 根据 track 信息解析出最终的音频源 URL
 * @param track - 要解析的 track
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
      const store = useStreamingStore();
      const streamUrl = await store.getStreamUrl(track);
      if (cacheEnabled) {
        // 缓存下载用独立 PlaySessionId
        const cacheUrl = await store.getStreamUrl(track, { playSessionId: crypto.randomUUID() });
        void window.api.cache.song.fetch(cacheKey!, "streaming", cacheUrl);
      }
      return { source: streamUrl, fromCache: false };
    } catch (err) {
      handleError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }
  // 在线源
  if (track.source === "online") {
    try {
      const url = await resolveOnlineUrl(track);
      if (!url) {
        handleError(ErrorCode.URL_RESOLVE_FAILED);
        return null;
      }
      if (cacheEnabled) {
        void window.api.cache.song.fetch(cacheKey!, "online", url);
      }
      return { source: url, fromCache: false };
    } catch (err) {
      handleError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }
  return null;
};
