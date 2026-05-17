import type { Track, TrackSource } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import { useStreamingStore } from "@/stores/streaming";
import { useSettingsStore } from "@/stores/settings";
import { usePluginsStore } from "@/stores/plugins";
import { resolveNeteaseUrl } from "@/apis/song/netease";
import { ErrorCode } from "@shared/types/errors";
import { handleError } from "@/utils/errors";

/** 在线平台 source → 插件 source key */
const PLATFORM_TO_PLUGIN_SOURCE: Record<Platform, string> = {
  netease: "wy",
  qqmusic: "tx",
  kugou: "kg",
};

/**
 * 检查给定 source 是否为在线平台
 * @param source - 要检查的 source
 */
const isOnlinePlatform = (source: TrackSource): source is Platform =>
  source === "netease" || source === "qqmusic" || source === "kugou";

/**
 * 派生缓存键
 * @param track - 要解析的 track
 * @returns 派生缓存键，如果该 track 不参与歌曲缓存则返回 null
 */
const cacheKeyForTrack = (track: Track): string | null => {
  if (track.source === "streaming" && track.serverId && track.originalId) {
    return `s:${track.serverId}:${track.originalId}:`;
  }
  if (isOnlinePlatform(track.source) && track.id) {
    return `o:${track.source}:${track.id}:`;
  }
  return null;
};

/**
 * 根据 track 信息解析出最终的音频源 URL
 * @param track - 要解析的 track
 * @returns 解析出的音频源 URL，如果无法解析则返回 null
 */
const resolveByPlugin = async (track: Track): Promise<string | null> => {
  if (!isOnlinePlatform(track.source)) return null;
  const pluginSource = PLATFORM_TO_PLUGIN_SOURCE[track.source];
  if (!pluginSource) return null;
  const plugins = usePluginsStore();
  const candidates = plugins.list.filter(
    (info) =>
      info.enabled &&
      info.status.state === "ready" &&
      info.status.sources[pluginSource]?.actions.includes("musicUrl"),
  );
  if (candidates.length === 0) {
    handleError(ErrorCode.NO_PLUGIN_AVAILABLE);
    return null;
  }
  // MusicInfoBase 形状；id / songmid / songId 三种别名都给，兼容不同年代脚本
  const totalSec = track.duration > 0 ? Math.round(track.duration / 1000) : 0;
  const interval =
    totalSec > 0
      ? `${Math.floor(totalSec / 60)
          .toString()
          .padStart(2, "0")}:${(totalSec % 60).toString().padStart(2, "0")}`
      : null;
  const singer = track.artists.map((artist) => artist.name).join("/");
  const musicInfo = {
    id: track.id,
    songmid: track.id,
    songId: track.id,
    name: track.title,
    singer,
    source: pluginSource,
    interval,
    meta: {
      songId: track.id,
      albumName: track.album?.name ?? "",
      albumId: track.album?.id,
      picUrl: track.cover ?? null,
    },
  };
  for (const plugin of candidates) {
    try {
      const res = await window.api.plugins.resolveUrl({
        pluginId: plugin.manifest.id,
        source: pluginSource,
        quality: "hq",
        musicInfo,
      });
      if (res?.url) return res.url;
    } catch (err) {
      console.warn("[plugin] resolveUrl failed", plugin.manifest.id, err);
    }
  }
  return null;
};

/**
 * 解析在线音频源 URL
 * @param track - 要解析的 track
 */
const resolveOnlineUrl = async (track: Track): Promise<string | null> => {
  try {
    if (track.source === "netease") {
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
  // 在线源（netease / qqmusic / kugou）
  if (isOnlinePlatform(track.source)) {
    try {
      const url = await resolveOnlineUrl(track);
      if (!url) {
        handleError(ErrorCode.URL_RESOLVE_FAILED);
        return null;
      }
      if (cacheEnabled) {
        void window.api.cache.song.fetch(cacheKey!, track.source, url);
      }
      return { source: url, fromCache: false };
    } catch (err) {
      handleError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }
  return null;
};
