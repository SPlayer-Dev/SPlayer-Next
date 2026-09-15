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
  source: ResolvedTrackSource | null;
  contextKey: string;
}

let currentToken = 0;
let cachedResult: NextTrackPreloadResult | null = null;
let currentContextKey: string | null = null;
let pendingCover: HTMLImageElement | null = null;
let stopContextWatch: (() => void) | null = null;

/**
 * 拼装上下文指纹，用于去重与作废
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
    settings.player.songLevel,
    settings.player.allowTrialPlay,
    settings.preset.fuckDjMode,
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
    if (currentContextKey === currentKey) {
      // 音源尚未解析完成，阻止迟到结果写回；同曲歌词和封面仍可继续使用
      currentToken++;
      currentContextKey = null;
    } else if (currentContextKey) {
      invalidateNextTrackPreload();
    }
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
  currentToken++;
  cachedResult = null;
  currentContextKey = null;
  return result;
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
    fuckDjMode: settings.preset.fuckDjMode,
    shuffleMode: status.shuffleMode,
  });

  if (!candidateResult) {
    invalidateNextTrackPreload();
    return;
  }

  const candidateTrack = candidateResult.track;
  const contextKey = buildContextKey(candidateTrack);
  // 歌词使用独立上下文去重，歌词偏好变化不需要重新解析音源
  preloadLyricForTrack(candidateTrack);

  // 上下文指纹一致且已有缓存，避免重复触发
  if (cachedResult && cachedResult.contextKey === contextKey) {
    return;
  }

  // 避免在异步生成过程中重复调度同一 contextKey
  if (currentContextKey === contextKey && !cachedResult) {
    return;
  }

  const token = ++currentToken;
  currentContextKey = contextKey;
  cachedResult = null;

  void (async () => {
    try {
      if (candidateTrack.cover) {
        void preloadCover(candidateTrack.cover);
      }
      // 音源预拉取
      const source = await resolveTrackSource(candidateTrack, {
        silent: true,
        streamingPlaySessionId: crypto.randomUUID(),
      });
      if (token !== currentToken) return;
      cachedResult = {
        trackId: candidateTrack.id,
        source,
        contextKey,
      };
    } catch (err) {
      console.warn("[nextPreload] Preload task failed silently:", err);
      if (token === currentToken) {
        invalidateNextTrackPreload();
      }
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
      settings.player.songLevel,
      settings.player.allowTrialPlay,
      settings.preset.fuckDjMode,
      status.playIndex,
      status.fmMode,
      status.shuffleMode,
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
      settings.system.localLyric.matchLevel,
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
