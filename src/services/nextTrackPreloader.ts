/**
 * 下一首歌曲预载服务
 */

import type { Track } from "@shared/types/player";
import type { ResolvedTrackSource } from "@/services/audioSource";
import { resolveTrackSource } from "@/services/audioSource";
import { getNextTrackCandidate } from "@/core/player/candidate";
import { invalidatePreloadedLyric, preloadLyricForTrack } from "@/services/lyric/preload";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useStreamingStore } from "@/stores/streaming";
import { usePluginsStore } from "@/stores/plugins";
import { useMediaStore } from "@/stores/media";
import * as queue from "@/stores/queue";

/** 预载结果 */
export interface NextTrackPreloadResult {
  trackId: string;
  /** 已就绪的原生槽位标识，缺省表示仅解析或缓存了音源 */
  preparedId?: string;
  source: ResolvedTrackSource | null;
  contextKey: string;
}

let currentToken = 0;
let nativePreloadId: string | null = null;
let preloadAbort: AbortController | null = null;
let cachedResult: NextTrackPreloadResult | null = null;
let currentContextKey: string | null = null;
let pendingCover: HTMLImageElement | null = null;
let stopContextWatch: (() => void) | null = null;

/**
 * 拼装上下文指纹，用于去重与作废
 * @param track - 下一曲候选及其本地文件或 CUE 信息
 * @returns 包含音源、音质和解析环境的上下文指纹
 */
const buildContextKey = (track: Track): string => {
  const settings = useSettingsStore();
  const streaming = useStreamingStore();
  const plugins = usePluginsStore();

  const parts = [
    track.id,
    track.source,
    track.serverId ?? "",
    track.originalId ?? "",
    track.path ?? "",
    track.cueAudioPath ?? "",
    track.cueStartMs ?? "",
    track.cueEndMs ?? "",
    settings.player.songLevel,
    settings.player.transitionMode,
    settings.player.transitionPreference,
    settings.player.allowTrialPlay,
    streaming.activeServerId ?? "",
    plugins.list
      .map((plugin) =>
        JSON.stringify([
          plugin.manifest.id,
          plugin.enabled,
          plugin.status.state,
          plugin.status.state === "ready" ? plugin.status.sources : null,
        ]),
      )
      .join(";"),
  ];

  return parts.join("::");
};

/**
 * 提前解码封面图片，仅利用 Chromium 渲染引擎缓存
 * @param url - 要预载的封面地址
 */
const preloadCover = async (url: string): Promise<void> => {
  if (!url) return;
  if (pendingCover) pendingCover.src = "";
  const image = new Image();
  pendingCover = image;
  try {
    image.decoding = "async";
    image.src = url;
    await image.decode();
  } catch {
    // ignore
  } finally {
    if (pendingCover === image) pendingCover = null;
  }
};

/**
 * 作废当前的预载缓存
 */
export const invalidateNextTrackPreload = (): void => {
  currentToken++;
  preloadAbort?.abort();
  preloadAbort = null;
  if (nativePreloadId) void window.api.player.cancelPrepared(nativePreloadId).catch(console.warn);
  nativePreloadId = null;
  cachedResult = null;
  currentContextKey = null;
  if (pendingCover) {
    pendingCover.src = "";
    pendingCover = null;
  }
  invalidatePreloadedLyric();
};

/**
 * 消费预载结果
 * @param track - 正在切入播放的目标歌曲
 * @returns 匹配的预载结果，未命中或已作废则返回 null
 */
export const consumePreloadedTrack = (track: Track): NextTrackPreloadResult | null => {
  if (!useSettingsStore().player.preloadNextTrack) {
    invalidateNextTrackPreload();
    return null;
  }
  const currentKey = buildContextKey(track);
  if (!cachedResult) {
    invalidateNextTrackPreload();
    return null;
  }
  if (cachedResult.trackId !== track.id) {
    invalidateNextTrackPreload();
    return null;
  }
  if (cachedResult.contextKey !== currentKey) {
    // 上下文已改变（如切换了音质），当前缓存作废
    invalidateNextTrackPreload();
    return null;
  }
  const result = cachedResult;
  nativePreloadId = null;
  preloadAbort = null;
  currentToken++;
  cachedResult = null;
  currentContextKey = null;
  return result;
};

/**
 * 查询与候选曲目匹配的原生备用槽位，不改变其所有权
 * @param track - 即将交接的目标曲目
 * @returns 仍有效且原生 PCM 已就绪的预载结果
 */
export const peekPreparedTrack = (track: Track): NextTrackPreloadResult | null => {
  if (!useSettingsStore().player.preloadNextTrack) return null;
  if (cachedResult?.trackId !== track.id || !cachedResult.preparedId) return null;
  return cachedResult.contextKey === buildContextKey(track) ? cachedResult : null;
};

/**
 * 调度下一首预载任务
 */
export const scheduleNextTrackPreload = (): void => {
  const settings = useSettingsStore();
  if (!settings.player.preloadNextTrack) {
    invalidateNextTrackPreload();
    return;
  }

  const status = useStatusStore();
  const currentTrack = status.currentTrack;
  if (!currentTrack || useMediaStore().track?.id !== currentTrack.id) {
    invalidateNextTrackPreload();
    return;
  }
  const candidateResult = getNextTrackCandidate({
    playIndex: status.playIndex,
    queue: queue.queue.value,
    fmMode: status.fmMode,
    skipKeywordsSongs: settings.preset.skipKeywordsSongs,
    skipTrackKeywords: settings.preset.skipTrackKeywords,
    shuffleMode: status.shuffleMode,
  });

  if (!candidateResult) {
    invalidateNextTrackPreload();
    return;
  }

  const candidateTrack = candidateResult.track;
  if (
    candidateTrack.source !== "local" &&
    (!settings.system.cache.songCache.enabled || !settings.system.cache.songCache.cacheStreaming)
  ) {
    invalidateNextTrackPreload();
    return;
  }
  const contextKey = buildContextKey(candidateTrack);
  // 上下文指纹一致且已有缓存，避免重复触发
  if (cachedResult && cachedResult.contextKey === contextKey) {
    preloadLyricForTrack(candidateTrack);
    return;
  }

  // 避免在异步生成过程中重复调度同一 contextKey
  if (currentContextKey === contextKey && !cachedResult) {
    preloadLyricForTrack(candidateTrack);
    return;
  }

  invalidateNextTrackPreload();
  preloadLyricForTrack(candidateTrack);
  const token = ++currentToken;
  const id = crypto.randomUUID();
  const abort = new AbortController();
  preloadAbort = abort;
  nativePreloadId = id;
  currentContextKey = contextKey;
  cachedResult = null;
  console.info("[player:preload] 开始预载下一曲", {
    trackId: candidateTrack.id,
    title: candidateTrack.title,
  });

  void (async () => {
    try {
      if (candidateTrack.cover) {
        void preloadCover(candidateTrack.cover);
      }
      // 音源预拉取
      let source = await resolveTrackSource(candidateTrack, {
        silent: true,
        streamingPlaySessionId: crypto.randomUUID(),
      });
      if (token !== currentToken) return;
      if (!source) {
        console.info("[player:preload] 下一曲未找到可用音源", {
          trackId: candidateTrack.id,
          title: candidateTrack.title,
        });
        return;
      }
      if (source.cacheRequest) {
        const cachedPath = await source.cacheRequest(id, abort.signal);
        if (token !== currentToken) return;
        if (cachedPath) source = { source: cachedPath, fromCache: true, provider: "cache" };
      }
      let preparedId: string | undefined;
      if (source.provider === "local" || source.fromCache) {
        const ready = await window.api.player.prepareNext(
          id,
          source.source,
          candidateTrack.cueStartMs,
          settings.player.transitionMode === "crossfade"
            ? settings.player.transitionPreference
            : undefined,
        );
        if (token !== currentToken) return;
        if (ready) preparedId = id;
      }
      if (!preparedId) {
        await window.api.player.cancelPrepared(id);
        if (token !== currentToken) return;
        nativePreloadId = null;
      }
      cachedResult = { trackId: candidateTrack.id, source, contextKey, preparedId };
      if (!preparedId) {
        console.info("[player:preload] 下一曲音源已准备，PCM 未预载", {
          trackId: candidateTrack.id,
          title: candidateTrack.title,
          source: source.provider,
        });
      }
    } catch (err) {
      if (token !== currentToken) return;
      console.warn("[player:preload] 下一曲预载失败", {
        trackId: candidateTrack.id,
        title: candidateTrack.title,
        error: err,
      });
      invalidateNextTrackPreload();
    }
  })();
};

/** 安装预载上下文监听 */
export const installNextTrackPreloadWatchers = (): void => {
  if (stopContextWatch) return;
  const settings = useSettingsStore();
  const status = useStatusStore();
  const streaming = useStreamingStore();
  const plugins = usePluginsStore();
  stopContextWatch = watch(
    () => [
      settings.player.preloadNextTrack,
      settings.player.transitionMode,
      settings.player.transitionPreference,
      settings.system.cache.songCache.enabled,
      settings.system.cache.songCache.cacheStreaming,
      settings.player.songLevel,
      settings.player.allowTrialPlay,
      status.playIndex,
      status.fmMode,
      status.shuffleMode,
      settings.preset.skipKeywordsSongs,
      settings.preset.skipTrackKeywords.join(","),
      queue.queue.value,
      streaming.activeServerId,
      settings.lyric.lyricSourcePreference,
      settings.lyric.lyricSourceOrder.join(","),
      settings.lyric.lyricFormatOrder.join(","),
      settings.lyric.smartPreferOnline,
      settings.lyric.preferPluginLyric,
      settings.system.lyric.enableOnlineTTMLLyric,
      settings.system.localLyric.enableLocalTTMLOverride,
      settings.system.localLyric.repoDir,
      plugins.list
        .map((plugin) =>
          JSON.stringify([
            plugin.manifest.id,
            plugin.enabled,
            plugin.status.state,
            plugin.status.state === "ready" ? plugin.status.sources : null,
          ]),
        )
        .join(";"),
    ],
    scheduleNextTrackPreload,
    { flush: "post" },
  );
};

/** 清理预载上下文监听 */
export const disposeNextTrackPreload = (): void => {
  stopContextWatch?.();
  stopContextWatch = null;
  invalidateNextTrackPreload();
};
