import type { Track } from "@shared/types/player";
import { useSettingsStore } from "@/stores/settings";
import { useStreamingStore } from "@/stores/streaming";
import { usePluginsStore } from "@/stores/plugins";
import { resolveLyricForPreload, type ResolvedLyric } from "./resolve";

type PreloadedLyricResult = { hit: false } | { hit: true; lyric: ResolvedLyric };

interface PreloadedLyric {
  trackKey: string;
  contextKey: string;
  controller: { cancelled: boolean };
  result: Promise<ResolvedLyric | null | undefined>;
}

let preloaded: PreloadedLyric | null = null;

/** 生成歌曲身份键 */
const buildTrackKey = (track: Track): string =>
  JSON.stringify([
    track.source,
    track.serverId ?? "",
    track.originalId ?? "",
    track.id,
    track.extId ?? "",
    track.title,
    track.artists.map((artist) => artist.name),
  ]);

/** 生成影响歌词解析结果的上下文键 */
const buildContextKey = (): string => {
  const settings = useSettingsStore();
  const streaming = useStreamingStore();
  const plugins = usePluginsStore();
  return JSON.stringify([
    settings.lyric.lyricSourcePreference,
    settings.lyric.lyricSourceOrder,
    settings.lyric.lyricFormatOrder,
    settings.lyric.smartPreferOnline,
    settings.lyric.preferPluginLyric,
    settings.system.lyric.enableOnlineTTMLLyric,
    settings.system.localLyric.enableLocalTTMLOverride,
    settings.system.localLyric.repoDir,
    streaming.activeServerId ?? "",
    plugins.list.map((plugin) => [
      plugin.manifest.id,
      plugin.enabled,
      plugin.status.state,
      plugin.status.state === "ready" ? plugin.status.sources : null,
    ]),
  ]);
};

/** 清空下一首歌词预载结果 */
export const invalidatePreloadedLyric = (): void => {
  if (preloaded) preloaded.controller.cancelled = true;
  preloaded = null;
};

/**
 * 预载候选歌曲的最终歌词结果
 * @param track - 候选歌曲
 */
export const preloadLyricForTrack = (track: Track): void => {
  if (track.source === "local") {
    invalidatePreloadedLyric();
    return;
  }
  const trackKey = buildTrackKey(track);
  const contextKey = buildContextKey();
  if (preloaded?.trackKey === trackKey && preloaded.contextKey === contextKey) return;
  invalidatePreloadedLyric();
  const controller = { cancelled: false };
  const result = resolveLyricForPreload(track, () => !controller.cancelled).catch((err) => {
    console.warn("[lyricPreload] 歌词预载失败:", err);
    return undefined;
  });
  preloaded = { trackKey, contextKey, controller, result };
};

/**
 * 消费目标歌曲的歌词预载结果
 * @param track - 即将加载的歌曲
 * @returns 命中状态和歌词结果
 */
export const consumePreloadedLyric = async (track: Track): Promise<PreloadedLyricResult> => {
  const current = preloaded;
  if (
    !current ||
    current.trackKey !== buildTrackKey(track) ||
    current.contextKey !== buildContextKey()
  ) {
    invalidatePreloadedLyric();
    return { hit: false };
  }
  preloaded = null;
  const lyric = await current.result;
  return lyric ? { hit: true, lyric } : { hit: false };
};
