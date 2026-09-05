import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricFormat, LyricInput, LyricMatchResult } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import { isPlatform } from "@shared/types/platform";
import { detectFormat } from "@/utils/lyric/parse";
import { useSettingsStore } from "@/stores/settings";
import { usePluginsStore } from "@/stores/plugins";
import { DEFAULT_LYRIC_FORMAT_ORDER, DEFAULT_LYRIC_SOURCE_ORDER } from "@/types/settings";
import { requestPlatformLyric, requestStreamingLyric, requestTTMLOverlay } from "./request";

/** 支持 AMLL TTML DB 的平台列表 */
const TTML_PLATFORMS = ["netease", "qqmusic"] as const;

/** 单个平台返回的在线歌词 */
export interface OnlineResult {
  source: { source: "online"; format: LyricFormat; platform: Platform };
  input: LyricInput;
}

/** 已解析的歌词候选 */
export interface ResolvedLyric {
  source: NonNullable<LyricData>;
  input: LyricInput;
}

/** 本地歌词读取结果 */
export type LocalLyric = { source: NonNullable<LyricData>; content: string };

/** 匹配结果转为在线歌词结果 */
const toOnlineResult = (data: LyricMatchResult): OnlineResult => ({
  source: { source: "online", format: data.format, platform: data.platform },
  input: {
    content: data.content,
    translation: data.translation,
    translationFormat: data.translationFormat,
    romaji: data.romaji,
    romajiFormat: data.romajiFormat,
  },
});

/** 请求并转换指定平台歌词 */
const resolvePlatformLyric = async (
  platform: Platform,
  track: Track,
): Promise<OnlineResult | null> => {
  const result = await requestPlatformLyric(platform, track);
  return result ? toOnlineResult(result) : null;
};

/**
 * 请求并解析流媒体服务端歌词
 * @param track - 歌曲信息
 * @returns 服务端歌词，不存在则返回 null
 */
export const resolveStreamingLyric = async (track: Track): Promise<ResolvedLyric | null> => {
  const text = await requestStreamingLyric(track);
  if (!text?.trim()) return null;
  return { source: { source: "external", format: detectFormat(text) }, input: { content: text } };
};

/** 提取内嵌歌词兜底 */
export const embeddedLyricFromDetail = (detail: TrackDetail | null): LocalLyric | null => {
  if (!detail?.embeddedLyric) return null;
  return {
    source: { source: "embedded", format: detectFormat(detail.embeddedLyric) },
    content: detail.embeddedLyric,
  };
};

/** 平台主格式可达列表 */
const PLATFORM_MAIN_FORMATS: Record<Platform, LyricFormat[]> = {
  netease: ["yrc", "lrc"],
  qqmusic: ["qrc", "lrc"],
  kugou: ["krc", "lrc"],
};

/**
 * 判断在指定平台是否能拿到比本地更优的主格式
 * @param platform - 平台
 * @param localFormat - 本地格式
 * @param formatOrder - 格式优先级
 */
const platformCanUpgrade = (
  platform: Platform,
  localFormat: LyricFormat,
  formatOrder: readonly LyricFormat[],
): boolean => {
  const localIdx = formatOrder.indexOf(localFormat);
  if (localIdx === -1) return true;
  for (const format of PLATFORM_MAIN_FORMATS[platform] ?? []) {
    const idx = formatOrder.indexOf(format);
    if (idx !== -1 && idx < localIdx) return true;
  }
  return false;
};

/**
 * 判断 candidateFormat 是否比 currentFormat 更优（优先级更高）
 * @param candidateFormat - 候选格式
 * @param currentFormat - 当前格式（为 null 时直接判定为更优）
 */
export const isBetterFormat = (
  candidateFormat: LyricFormat,
  currentFormat: LyricFormat | null,
): boolean => {
  if (!currentFormat) return true;
  const order = useSettingsStore().lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const currIdx = order.indexOf(currentFormat);
  const candIdx = order.indexOf(candidateFormat);
  const currRank = currIdx === -1 ? order.length : currIdx;
  const candRank = candIdx === -1 ? order.length : candIdx;
  return candRank < currRank;
};

/** 判断在线结果是否优于本地歌词 */
const isOnlineResultUpgrade = (result: OnlineResult, localFormat: LyricFormat): boolean =>
  isBetterFormat(result.source.format, localFormat);

interface OnlinePreferenceOptions {
  hasLocal: boolean;
  localFormat: LyricFormat | null;
  onCandidate?: (result: OnlineResult) => void;
  shouldContinue?: () => boolean;
}

/**
 * 按当前歌词来源偏好获取在线歌词
 * @param track - 歌曲信息
 * @param options - 本地歌词与竞态选项
 */
export const resolveOnlineByPreference = async (
  track: Track,
  options: OnlinePreferenceOptions,
): Promise<OnlineResult | null> => {
  const settings = useSettingsStore();
  const preference = settings.lyric.lyricSourcePreference;
  const isCurrent = options.shouldContinue ?? (() => true);
  if (preference === "self") {
    return isPlatform(track.source) ? resolvePlatformLyric(track.source, track) : null;
  }
  if (preference !== "auto") return resolvePlatformLyric(preference, track);

  const order = settings.lyric.lyricSourceOrder ?? DEFAULT_LYRIC_SOURCE_ORDER;
  const formatOrder = settings.lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  let candidates: Platform[] = [...order];
  if (options.hasLocal) {
    if (!settings.lyric.smartPreferOnline || !options.localFormat) return null;
    candidates = order.filter((platform) =>
      platformCanUpgrade(platform, options.localFormat!, formatOrder),
    );
    if (candidates.length === 0) return null;
  }

  if (settings.lyric.smartPreferOnline) {
    let best: OnlineResult | null = null;
    const localIdx =
      options.hasLocal && options.localFormat ? formatOrder.indexOf(options.localFormat) : -1;
    let bestRank = localIdx === -1 ? Infinity : localIdx;
    await Promise.all(
      candidates.map(async (platform) => {
        const result = await resolvePlatformLyric(platform, track);
        if (!isCurrent() || !result) return;
        const idx = formatOrder.indexOf(result.source.format);
        const rank = idx === -1 ? Infinity : idx;
        if (rank < bestRank) {
          best = result;
          bestRank = rank;
          options.onCandidate?.(result);
        }
      }),
    );
    return isCurrent() ? best : null;
  }

  for (const platform of candidates) {
    const result = await resolvePlatformLyric(platform, track);
    if (!isCurrent()) return null;
    if (!result) continue;
    if (
      options.hasLocal &&
      options.localFormat &&
      !isOnlineResultUpgrade(result, options.localFormat)
    ) {
      continue;
    }
    return result;
  }
  return null;
};

/** 判断是否应该尝试 TTML 升级 */
const shouldTryTTMLByFormat = (mainFormat: LyricFormat): boolean => {
  const settings = useSettingsStore();
  if (!settings.system.lyric.enableOnlineTTMLLyric) return false;
  if (settings.lyric.lyricSourcePreference === "self") return false;
  const order = settings.lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const ttmlIdx = order.indexOf("ttml");
  if (ttmlIdx === -1) return false;
  const mainIdx = order.indexOf(mainFormat);
  return mainIdx === -1 || ttmlIdx < mainIdx;
};

/**
 * 拉取在线歌词对应的 TTML 覆盖版本
 * @param track - 歌曲信息
 * @param online - 在线歌词结果
 */
export const resolveTTMLOverlay = async (
  track: Track,
  online: OnlineResult,
): Promise<ResolvedLyric | null> => {
  if (!shouldTryTTMLByFormat(online.source.format)) return null;
  const candidates = await Promise.all(
    TTML_PLATFORMS.map(async (platform) => ({
      platform,
      response: await requestTTMLOverlay(track, platform),
    })),
  );
  const match = candidates.find(
    (candidate): candidate is typeof candidate & { response: { ok: true; data: string } } =>
      candidate.response.ok && !!candidate.response.data,
  );
  if (!match) return null;
  return {
    source: { source: "online", format: "ttml", platform: match.platform },
    input: { content: match.response.data },
  };
};

/**
 * 按歌词来源偏好解析流媒体歌词
 * @param track - 流媒体歌曲
 * @param shouldContinue - 竞态检查
 * @returns 最终歌词候选，不存在则返回 null
 */
export const resolveStreamingByPreference = async (
  track: Track,
  shouldContinue: () => boolean = () => true,
): Promise<ResolvedLyric | null> => {
  const preference = useSettingsStore().lyric.lyricSourcePreference;
  let serverLyric: ResolvedLyric | null = null;

  if (preference === "self" || preference === "auto") {
    serverLyric = await resolveStreamingLyric(track);
    if (!shouldContinue()) return null;
    if (preference === "self") return serverLyric;
  }

  const online = await resolveOnlineByPreference(track, {
    hasLocal: !!serverLyric,
    localFormat: serverLyric?.source.format ?? null,
    shouldContinue,
  });
  if (!shouldContinue()) return null;
  if (online) {
    return { source: online.source, input: online.input };
  }
  if (serverLyric || preference === "auto") return serverLyric;

  return resolveStreamingLyric(track);
};

/**
 * 从本地 TTML 仓库解析歌词
 * @param track - 歌曲信息
 * @returns 本地仓库歌词，不存在则返回 null
 */
export const resolveLocalRepoLyric = async (track: Track): Promise<ResolvedLyric | null> => {
  const settings = useSettingsStore();
  if (
    !settings.system.localLyric?.enableLocalTTMLOverride ||
    !settings.system.localLyric?.repoDir
  ) {
    return null;
  }
  const resp = await window.api.lyrics.matchLocalTTML(track);
  if (!resp.ok || !resp.data) return null;
  return { source: { source: "external", format: "ttml" }, input: { content: resp.data } };
};

/**
 * 从插件解析歌词
 * @param track - 歌曲信息
 * @returns 首个有效插件歌词，不存在则返回 null
 */
export const resolvePluginLyric = async (track: Track): Promise<ResolvedLyric | null> => {
  const plugins = usePluginsStore();
  for (const info of plugins.list) {
    if (!info.enabled || info.status.state !== "ready") continue;
    for (const [source, cap] of Object.entries(info.status.sources)) {
      if (!cap.actions.includes("musicLyric")) continue;
      const resp = await window.api.plugins.matchLyric({
        pluginId: info.manifest.id,
        source,
        track,
      });
      if (!resp.ok || !resp.data) continue;
      const content = resp.data.awlyric ?? resp.data.lyric;
      if (!content?.trim()) continue;
      return {
        source: { source: "online", format: detectFormat(content) },
        input: { content, translation: resp.data.tlyric, romaji: resp.data.rlyric },
      };
    }
  }
  return null;
};

/** 插件歌词是否优先于内置来源 */
export const isPluginLyricPreferred = (): boolean =>
  useSettingsStore().lyric.preferPluginLyric === true;

/**
 * 为下一首歌曲解析最终歌词结果
 * 本地歌曲依赖实际加载后的 TrackDetail，不在此处提前解析
 * @param track - 候选歌曲
 * @param shouldContinue - 竞态检查
 * @returns 最终歌词，不存在或不支持预载则返回 null
 */
export const resolveLyricForPreload = async (
  track: Track,
  shouldContinue: () => boolean,
): Promise<ResolvedLyric | null> => {
  if (track.source === "local") return null;

  const localRepo = await resolveLocalRepoLyric(track);
  if (!shouldContinue()) return null;
  if (localRepo) return localRepo;

  // 插件优选：请求先行发出，与下方正常解析并发
  const pluginTask = isPluginLyricPreferred() ? resolvePluginLyric(track) : null;

  if (track.source === "streaming") {
    const streaming = await resolveStreamingByPreference(track, shouldContinue);
    if (!shouldContinue()) return null;
    if (pluginTask) {
      const plugin = await pluginTask;
      if (!shouldContinue()) return null;
      if (plugin && isBetterFormat(plugin.source.format, streaming?.source.format ?? null)) {
        return plugin;
      }
      return streaming ?? plugin ?? null;
    }
    if (streaming) return streaming;
    const plugin = await resolvePluginLyric(track);
    return shouldContinue() ? plugin : null;
  }

  const online = await resolveOnlineByPreference(track, {
    hasLocal: false,
    localFormat: null,
    shouldContinue,
  });
  if (!shouldContinue()) return null;
  const normal: ResolvedLyric | null = online
    ? { source: online.source, input: online.input }
    : null;
  if (pluginTask) {
    const plugin = await pluginTask;
    if (!shouldContinue()) return null;
    if (plugin && isBetterFormat(plugin.source.format, normal?.source.format ?? null)) {
      return plugin;
    }
    return normal ?? plugin ?? null;
  }
  if (normal) return normal;

  const plugin = await resolvePluginLyric(track);
  return shouldContinue() ? plugin : null;
};
