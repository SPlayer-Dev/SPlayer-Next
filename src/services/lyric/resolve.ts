import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricFormat, LyricInput } from "lyric-kit";
import type { LyricData, LyricManualMatch, LyricMatchResult } from "@shared/types/lyrics";

import type { Platform } from "@shared/types/platform";
import { isPlatform } from "@shared/types/platform";
import { detectFormat, hasWordTiming } from "lyric-kit";
import { useSettingsStore } from "@/stores/settings";
import { usePluginsStore } from "@/stores/plugins";
import { DEFAULT_LYRIC_FORMAT_ORDER, DEFAULT_LYRIC_SOURCE_ORDER } from "@/types/settings";
import {
  requestPlatformLyric,
  requestStreamingLyric,
  requestTTMLOverlay,
  requestTTMLSearch,
} from "./request";
import { parseMainLines, verifyCandidate } from "./verify";

/** 支持 AMLL TTML DB 的平台列表 */
const TTML_PLATFORMS = ["netease", "qqmusic"] as const;

/** 单个平台返回的在线歌词 */
export interface OnlineResult {
  source: { source: "online"; format: LyricFormat; platform: Platform; timeShiftMs?: number };
  input: LyricInput;
}

/** 已解析的歌词候选 */
export interface ResolvedLyric {
  source: NonNullable<LyricData>;
  input: LyricInput;
  /** 用户手动选择的歌词，不再被 TTML 升级覆盖 */
  pinned?: boolean;
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

/** 最佳候选被拒时最多补试的同平台候选数 */
const FALLBACK_CANDIDATE_LIMIT = 3;

/**
 * 最佳候选内容不符时，补试同平台其他同名同歌手的版本
 * 通过验证的候选会记为该平台的匹配，下次直接使用
 * @param platform - 平台
 * @param track - 歌曲信息
 * @param baselineLines - 验证基准
 * @param isCurrent - 竞态检查
 * @returns 通过验证的歌词及其主歌词行，没有则返回 null
 */
const resolveFallbackCandidate = async (
  platform: Platform,
  track: Track,
  baselineLines: ReturnType<typeof parseMainLines>,
  isCurrent: () => boolean,
): Promise<{ result: OnlineResult; lines: ReturnType<typeof parseMainLines> } | null> => {
  const keyword = [track.title, ...(track.artists ?? []).map((artist) => artist.name)].join(" ");
  const resp = await window.api.lyrics.searchCandidates(platform, keyword, track);
  if (!resp.ok || !isCurrent()) return null;
  const title = track.title.toLowerCase();
  const candidates = resp.data
    .filter(
      (candidate) =>
        !candidate.best &&
        candidate.tags.includes("artist") &&
        candidate.name.toLowerCase().includes(title),
    )
    .slice(0, FALLBACK_CANDIDATE_LIMIT);
  for (const candidate of candidates) {
    const result = await requestPlatformMatch(track, platform, candidate);
    if (!isCurrent()) return null;
    const lines = result ? parseMainLines(result.source.format, result.input.content) : [];
    if (!result || lines.length === 0) continue;
    const accepted = await verifyCandidate(baselineLines, lines, result, track);
    if (!isCurrent()) return null;
    if (accepted) {
      // ponytail: QM 只记 songid 不记 mid，本地 TTML 仓库按 mid 索引时会漏，需要时再补
      void window.api.lyrics.rememberMatch(track, platform, candidate.id);
      return { result: accepted, lines };
    }
  }
  return null;
};

interface OnlinePreferenceOptions {
  /** 已有的本地或服务端歌词，作为候选的验证基准 */
  local?: ResolvedLyric | null;
  onCandidate?: (result: ResolvedLyric) => void;
  shouldContinue?: () => boolean;
  /** 后台场景逐个请求，结果已无法被超越时不再请求后续平台 */
  sequential?: boolean;
}

/**
 * 以歌曲自身平台或已有歌词为基准，从其余平台选出通过验证的最优歌词
 * 基准到达后立即上屏；有基准时等到结果不可能再变才提交，播放中最多替换一次
 * @param track - 歌曲信息
 * @param platforms - 参与请求的平台
 * @param options - 基准歌词与请求选项
 * @returns 最优在线歌词，没有比已有歌词更优的结果时为 null
 */
const resolveVerifiedOnline = async (
  track: Track,
  platforms: Platform[],
  options: OnlinePreferenceOptions,
): Promise<OnlineResult | null> => {
  const isCurrent = options.shouldContinue ?? (() => true);
  const formatOrder = useSettingsStore().lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const formatRank = (format: LyricFormat): number => {
    const index = formatOrder.indexOf(format);
    return index === -1 ? Infinity : index;
  };

  const ownPlatform = platforms.find((platform) => platform === track.source);
  const others = platforms.filter((platform) => platform !== ownPlatform);
  const requests = new Map(
    options.sequential
      ? []
      : others.map((platform) => [platform, resolvePlatformLyric(platform, track)] as const),
  );
  const own = ownPlatform ? await resolvePlatformLyric(ownPlatform, track) : null;
  if (!isCurrent()) return null;
  if (own) options.onCandidate?.(own);

  const baseline = options.local ?? own;
  const baselineLines = baseline
    ? parseMainLines(baseline.source.format, baseline.input.content)
    : [];
  const hasBaseline = baseline !== null && baselineLines.length > 0;
  let best = own;
  let bestRank = hasBaseline ? formatRank(baseline.source.format) : Infinity;
  let committed = own;
  const pending = new Set(others);
  const canBeatBest = (platform: Platform): boolean =>
    PLATFORM_MAIN_FORMATS[platform].some((format) => formatRank(format) < bestRank);

  const evaluate = async (platform: Platform): Promise<void> => {
    const result = await (requests.get(platform) ?? resolvePlatformLyric(platform, track));
    if (!isCurrent()) return;
    if (result) {
      const lines = parseMainLines(result.source.format, result.input.content);
      // 没有真实逐字时间的候选只相当于普通 LRC
      const rankOf = (lyricLines: typeof lines, format: LyricFormat): number =>
        formatRank(hasWordTiming(lyricLines) ? format : "lrc");
      const rank = rankOf(lines, result.source.format);
      if (lines.length > 0 && rank < bestRank) {
        let accepted = hasBaseline
          ? await verifyCandidate(baselineLines, lines, result, track)
          : result;
        let acceptedRank = rank;
        if (!isCurrent()) return;
        if (!accepted && hasBaseline) {
          const fallback = await resolveFallbackCandidate(
            platform,
            track,
            baselineLines,
            isCurrent,
          );
          if (!isCurrent()) return;
          accepted = fallback?.result ?? null;
          acceptedRank = fallback ? rankOf(fallback.lines, fallback.result.source.format) : rank;
        }
        if (accepted && acceptedRank < bestRank) {
          best = accepted;
          bestRank = acceptedRank;
        }
      }
    }
    // 验证结束才算完成，否则复核中的更优候选会被其他平台抢先
    pending.delete(platform);
    // 没有基准时屏幕还是空的，先到先显示
    if (best && best !== committed && (!hasBaseline || ![...pending].some(canBeatBest))) {
      committed = best;
      options.onCandidate?.(best);
    }
  };

  if (options.sequential) {
    for (const platform of others) {
      if (!isCurrent()) return null;
      if (canBeatBest(platform)) await evaluate(platform);
    }
  } else {
    await Promise.all(others.map(evaluate));
  }
  return isCurrent() ? best : null;
};

/**
 * 按歌词来源偏好获取在线歌词
 * @param track - 歌曲信息
 * @param options - 基准歌词与请求选项
 * @returns 符合偏好的在线歌词，无可用结果时为 null
 */
export const resolveOnlineByPreference = async (
  track: Track,
  options: OnlinePreferenceOptions = {},
): Promise<OnlineResult | null> => {
  if (track.source === "plugin") return null;
  const settings = useSettingsStore();
  const preference = settings.lyric.lyricSourcePreference;
  const isCurrent = options.shouldContinue ?? (() => true);
  if (preference === "self") {
    return isPlatform(track.source) ? resolvePlatformLyric(track.source, track) : null;
  }
  if (preference !== "auto") {
    const preferred = await resolvePlatformLyric(preference, track);
    if (!isCurrent()) return null;
    if (preferred) return preferred;
  }

  const order = settings.lyric.lyricSourceOrder ?? DEFAULT_LYRIC_SOURCE_ORDER;
  const formatOrder = settings.lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  let candidates: Platform[] =
    preference === "auto" ? [...order] : order.filter((p) => p !== preference);
  const { local } = options;
  if (local) {
    if (!settings.lyric.smartPreferOnline) return null;
    candidates = candidates.filter((platform) =>
      platformCanUpgrade(platform, local.source.format, formatOrder),
    );
    if (candidates.length === 0) return null;
  }

  if (settings.lyric.smartPreferOnline) return resolveVerifiedOnline(track, candidates, options);

  // 自身平台的歌词最可靠，优先于音源排序
  const ownFirst = [...candidates].sort(
    (left, right) => Number(right === track.source) - Number(left === track.source),
  );
  for (const platform of ownFirst) {
    const result = await resolvePlatformLyric(platform, track);
    if (!isCurrent()) return null;
    if (result) return result;
  }
  return null;
};

/** 判断是否应该尝试 TTML 升级 */
const shouldTryTTMLByFormat = (mainFormat: LyricFormat | null): boolean => {
  const settings = useSettingsStore();
  if (!settings.system.lyric.enableOnlineTTMLLyric) return false;
  if (settings.lyric.lyricSourcePreference === "self") return false;
  const order = settings.lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const ttmlIdx = order.indexOf("ttml");
  if (ttmlIdx === -1) return false;
  const mainIdx = mainFormat ? order.indexOf(mainFormat) : -1;
  return mainIdx === -1 || ttmlIdx < mainIdx;
};

/**
 * 获取歌曲的 TTML 覆盖版本，优先按平台 ID，未命中时按元数据搜索
 * @param track - 歌曲信息
 * @param mainFormat - 当前主歌词格式，没有歌词时为 null
 * @returns 可用的 TTML 歌词，无覆盖版本时为 null
 */
export const resolveTTMLOverlay = async (
  track: Track,
  mainFormat: LyricFormat | null,
): Promise<ResolvedLyric | null> => {
  if (track.source === "plugin") return null;
  if (!shouldTryTTMLByFormat(mainFormat)) return null;
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
  if (match) {
    return {
      source: { source: "online", format: "ttml", platform: match.platform },
      input: { content: match.response.data },
    };
  }
  const searched = await requestTTMLSearch(track);
  if (!searched.ok || !searched.data) return null;
  return { source: { source: "online", format: "ttml" }, input: { content: searched.data } };
};

/**
 * 按歌词来源偏好解析流媒体歌词
 * @param track - 流媒体歌曲
 * @param options - 请求选项，服务端歌词也通过 onCandidate 立即提交
 * @returns 最终歌词候选，不存在则返回 null
 */
export const resolveStreamingByPreference = async (
  track: Track,
  options: Omit<OnlinePreferenceOptions, "local"> = {},
): Promise<ResolvedLyric | null> => {
  const preference = useSettingsStore().lyric.lyricSourcePreference;
  const shouldContinue = options.shouldContinue ?? (() => true);
  let serverLyric: ResolvedLyric | null = null;

  if (preference === "self" || preference === "auto") {
    serverLyric = await resolveStreamingLyric(track);
    if (!shouldContinue()) return null;
    if (preference === "self") return serverLyric;
    if (serverLyric) options.onCandidate?.(serverLyric);
  }

  const online = await resolveOnlineByPreference(track, { ...options, local: serverLyric });
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
const resolveLocalRepoLyric = async (track: Track): Promise<ResolvedLyric | null> => {
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
 * 按平台歌曲 id 请求歌词
 * KG 取词依赖歌名和时长，歌曲信息与候选不一致时要用候选自己的信息
 * @param track - 歌曲信息
 * @param platform - 平台
 * @param match - 候选
 * @returns 对应歌词，不存在则返回 null
 */
const requestPlatformMatch = async (
  track: Track,
  platform: Platform,
  match: LyricManualMatch,
): Promise<OnlineResult | null> => {
  const resp = await window.api.lyrics.matchById(
    platform,
    match.id,
    { ...track, title: match.name, duration: match.duration ?? track.duration },
    false,
  );
  return resp.ok && resp.data ? toOnlineResult(resp.data) : null;
};

/**
 * 请求手动选择或候选对应的歌词
 * @param track - 歌曲信息
 * @param match - 手动选择或候选
 * @returns 对应歌词，不存在则返回 null
 */
export const requestManualLyric = async (
  track: Track,
  match: LyricManualMatch,
): Promise<ResolvedLyric | null> => {
  if (match.platform === "ttml") {
    const ttml = await window.api.lyrics.fetchTTMLById(match.id);
    if (!ttml.ok || !ttml.data) return null;
    return { source: { source: "online", format: "ttml" }, input: { content: ttml.data } };
  }
  return requestPlatformMatch(track, match.platform, match);
};

/**
 * 解析用户指定的歌词，手动选择优先于本地歌词库
 * 选择的歌词暂时取不到时不阻塞播放，继续走后续来源
 * @param track - 歌曲信息
 * @returns 用户指定的歌词，不存在则返回 null
 */
export const resolveUserLyric = async (track: Track): Promise<ResolvedLyric | null> => {
  const match = await window.api.lyrics.getManualMatch(track);
  const lyric = match && (await requestManualLyric(track, match));
  if (lyric) return { ...lyric, pinned: true };
  return resolveLocalRepoLyric(track);
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
    if (track.source === "plugin" && info.manifest.id !== track.plugin?.pluginId) continue;
    for (const [source, cap] of Object.entries(info.status.sources)) {
      if (track.source === "plugin" && source !== track.plugin?.source) continue;
      if (!cap.actions.includes("musicLyric")) continue;
      const resp = await window.api.plugins.matchLyric({
        pluginId: info.manifest.id,
        source,
        track,
      });
      const current = plugins.list.find((plugin) => plugin.manifest.id === info.manifest.id);
      if (
        !current?.enabled ||
        current.status.state !== "ready" ||
        !current.status.sources[source]?.actions.includes("musicLyric")
      ) {
        continue;
      }
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

  const userLyric = await resolveUserLyric(track);
  if (!shouldContinue()) return null;
  if (userLyric) return userLyric;

  if (track.source === "plugin") {
    const plugin = await resolvePluginLyric(track);
    return shouldContinue() ? plugin : null;
  }

  // 插件优选：请求先行发出，与下方正常解析并发
  const pluginTask = isPluginLyricPreferred() ? resolvePluginLyric(track) : null;

  if (track.source === "streaming") {
    const streaming = await resolveStreamingByPreference(track, {
      shouldContinue,
      sequential: true,
    });
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

  const online = await resolveOnlineByPreference(track, { shouldContinue, sequential: true });
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
