import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricFormat, LyricInput, LyricMatchResult } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import { isPlatform } from "@shared/types/platform";
import { detectFormat } from "@/utils/lyric/parse";
import { useSettingsStore } from "@/stores/settings";
import { useStreamingStore } from "@/stores/streaming";
import { usePluginsStore } from "@/stores/plugins";
import { DEFAULT_LYRIC_FORMAT_ORDER, DEFAULT_LYRIC_SOURCE_ORDER } from "@/types/settings";
import { buildLyricValidationKey, evaluateLyricMatch } from "@/utils/lyric/matchQuality";

/** 一次在线 fetch 的结果 */
export interface OnlineResult {
  source: { source: "online"; format: LyricFormat; platform: Platform };
  input: LyricInput;
  candidate?: LyricMatchResult["candidate"];
}

/** 已解析的原始歌词候选 */
export interface ResolvedLyric {
  source: NonNullable<LyricData>;
  input: LyricInput;
}

/** 本地歌词读取结果 */
export type LocalLyric = { source: NonNullable<LyricData>; content: string };

/** 匹配结果转为可提交歌词输入 */
export const toLyricInput = (data: LyricMatchResult): LyricInput => ({
  content: data.content,
  translation: data.translation,
  translationFormat: data.translationFormat,
  romaji: data.romaji,
  romajiFormat: data.romajiFormat,
});

/** 匹配结果转为在线歌词结果 */
export const toOnlineResult = (data: LyricMatchResult): OnlineResult => ({
  source: { source: "online", format: data.format, platform: data.platform },
  input: toLyricInput(data),
  candidate: data.candidate,
});

/** 提取内嵌歌词兜底 */
export const embeddedLyricFromDetail = (detail: TrackDetail | null): LocalLyric | null => {
  if (!detail?.embeddedLyric) return null;
  return {
    source: { source: "embedded", format: detectFormat(detail.embeddedLyric) },
    content: detail.embeddedLyric,
  };
};

/**
 * 向指定平台请求歌词
 * track.platform 等于目标平台时走 byId（精确），否则 byQuery（搜索打分）
 */
export const fetchFromPlatform = async (
  platform: Platform,
  track: Track,
  reference?: ResolvedLyric,
): Promise<OnlineResult | null> => {
  const mode = track.source === platform ? "byId" : "byQuery";
  // QM lyric 接口要数字 songID
  const lookupId = platform === "qqmusic" ? (track.extId ?? track.id) : track.id;
  if (mode === "byId") {
    const resp = await window.api.lyrics.matchById(platform, lookupId);
    if (!resp.ok || !resp.data) return null;
    return toOnlineResult(resp.data);
  }

  const excludedIds: string[] = [];
  const validationKey = reference
    ? buildLyricValidationKey(reference.input, reference.source.format)
    : undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await window.api.lyrics.matchByQuery(platform, track, {
      excludedIds,
      validationKey,
    });
    if (!resp.ok || !resp.data) return null;
    const result = toOnlineResult(resp.data);
    if (!reference) return result;
    if (!result.candidate) return null;

    const decision = evaluateLyricMatch(
      reference.input,
      reference.source.format,
      result.input,
      result.source.format,
      track.duration,
      result.candidate.duration,
    );
    console.info(
      `[lyrics] ${platform}:${result.candidate.platformId} ${decision.status}/${decision.reason}`,
      decision.metrics,
    );
    if (decision.status === "accepted") {
      if (!result.candidate.validated) {
        await window.api.lyrics.confirmMatch({
          platform,
          track: toRaw(track),
          candidate: result.candidate,
          validationKey: decision.validationKey,
        });
      }
      return result;
    }
    excludedIds.push(result.candidate.platformId);
  }
  return null;
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
  for (const f of PLATFORM_MAIN_FORMATS[platform] ?? []) {
    const idx = formatOrder.indexOf(f);
    if (idx !== -1 && idx < localIdx) return true;
  }
  return false;
};

/**
 * 单次在线结果是否真的优于本地
 * @param result - 在线结果
 * @param localFormat - 本地格式
 */
const isOnlineResultUpgrade = (result: OnlineResult, localFormat: LyricFormat): boolean => {
  const settings = useSettingsStore();
  const formatOrder = settings.lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const localIdx = formatOrder.indexOf(localFormat);
  if (localIdx === -1) return true;
  const mainIdx = formatOrder.indexOf(result.source.format);
  return mainIdx !== -1 && mainIdx < localIdx;
};

interface OnlinePreferenceOptions {
  hasLocal: boolean;
  localFormat: LyricFormat | null;
  reference?: ResolvedLyric;
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
  const sourceResult = isPlatform(track.source)
    ? await fetchFromPlatform(track.source, track)
    : null;
  if (!isCurrent()) return null;
  const reference: ResolvedLyric | undefined = options.reference ?? sourceResult ?? undefined;
  if (preference === "self") {
    return sourceResult;
  }
  if (preference === "auto") {
    const order = settings.lyric.lyricSourceOrder ?? DEFAULT_LYRIC_SOURCE_ORDER;
    const formatOrder = settings.lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
    const baselineFormat = options.localFormat ?? sourceResult?.source.format ?? null;
    let candidates: Platform[] = order.filter((platform) => platform !== track.source);
    if (options.hasLocal && !settings.lyric.smartPreferOnline) return null;
    if (settings.lyric.smartPreferOnline && baselineFormat) {
      candidates = candidates.filter((platform) =>
        platformCanUpgrade(platform, baselineFormat, formatOrder),
      );
    }
    if (candidates.length === 0) return sourceResult;
    if (settings.lyric.smartPreferOnline) {
      let best: OnlineResult | null = sourceResult;
      const baselineIdx = baselineFormat ? formatOrder.indexOf(baselineFormat) : -1;
      let bestRank = baselineIdx === -1 ? Infinity : baselineIdx;
      await Promise.all(
        candidates.map(async (platform) => {
          const result = await fetchFromPlatform(platform, track, reference);
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
      if (!isCurrent()) return null;
      return best;
    }
    for (const platform of candidates) {
      const result = await fetchFromPlatform(platform, track, reference);
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
    return sourceResult;
  }
  if (preference === track.source) return sourceResult;
  return (await fetchFromPlatform(preference, track, reference)) ?? sourceResult;
};

/**
 * 是否对该平台尝试 TTML 升级
 * @param platform - 平台
 * @param mainFormat - 主格式
 */
export const shouldTryTTML = (
  platform: Platform,
  mainFormat: LyricFormat,
): platform is "netease" | "qqmusic" => {
  if (platform !== "netease" && platform !== "qqmusic") return false;
  const settings = useSettingsStore();
  if (!settings.system.lyric.enableOnlineTTMLLyric) return false;
  if (settings.lyric.lyricSourcePreference === "self") return false;
  const order = settings.lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const ttmlIdx = order.indexOf("ttml");
  if (ttmlIdx === -1) return false;
  const mainIdx = order.indexOf(mainFormat);
  if (mainIdx === -1) return true;
  return ttmlIdx < mainIdx;
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
  if (!shouldTryTTML(online.source.platform, online.source.format)) return null;
  const resp = await window.api.lyrics.fetchTTMLOverlay(track, online.source.platform);
  if (!resp.ok || !resp.data) return null;
  const resolved: ResolvedLyric = {
    source: { source: "online", format: "ttml", platform: online.source.platform },
    input: { content: resp.data },
  };
  const decision = evaluateLyricMatch(
    online.input,
    online.source.format,
    resolved.input,
    resolved.source.format,
    track.duration,
    track.duration,
  );
  console.info(
    `[lyrics] ttml:${online.source.platform} ${decision.status}/${decision.reason}`,
    decision.metrics,
  );
  return decision.status === "accepted" ? resolved : null;
};

/**
 * 本地 TTML 歌词库匹配
 * @param track - 歌曲信息
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
 * 插件兜底匹配歌词
 * @param track - 歌曲信息
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
      if (!content || !content.trim()) continue;
      return {
        source: { source: "online", format: detectFormat(content) },
        input: { content, translation: resp.data.tlyric, romaji: resp.data.rlyric },
      };
    }
  }
  return null;
};

/**
 * 取流媒体服务端歌词
 * @param track - 歌曲信息
 */
export const resolveStreamingServerLyric = async (track: Track): Promise<ResolvedLyric | null> => {
  const text = await useStreamingStore().getLyrics(track);
  if (!text?.trim()) return null;
  return { source: { source: "external", format: detectFormat(text) }, input: { content: text } };
};
