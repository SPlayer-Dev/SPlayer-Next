/**
 * 歌词加载服务
 */

import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricFormat, LyricInput } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import { isPlatform } from "@shared/types/platform";
import { bestExternalIndex, detectFormat } from "@/utils/lyric/parse";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useStreamingStore } from "@/stores/streaming";
import { DEFAULT_LYRIC_FORMAT_ORDER, DEFAULT_LYRIC_SOURCE_ORDER } from "@/types/settings";

/** 一次在线 fetch 的结果 */
interface OnlineResult {
  source: { source: "online"; format: LyricFormat; platform: Platform };
  input: LyricInput;
}

/** 竞态 token */
let currentToken = 0;

/**
 * 读取本地歌词
 * @param detail - 歌曲详细信息
 */
const readLocal = async (
  detail: TrackDetail,
): Promise<{ source: NonNullable<LyricData>; content: string } | null> => {
  const order = useSettingsStore().lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const idx = bestExternalIndex(detail.externalLyrics, order);
  if (idx !== -1) {
    const ext = detail.externalLyrics[idx];
    const result = await window.api.player.readLyricFile(ext.path);
    if (!result.success || result.data == null) return null;
    return { source: { source: "external", format: ext.format }, content: result.data };
  }
  if (detail.embeddedLyric) {
    return {
      source: { source: "embedded", format: detectFormat(detail.embeddedLyric) },
      content: detail.embeddedLyric,
    };
  }
  return null;
};

/**
 * 向指定平台请求歌词
 * track.platform 等于目标平台时走 byId（精确），否则 byQuery（搜索打分）
 */
const fetchFromPlatform = async (
  platform: Platform,
  track: Track,
): Promise<OnlineResult | null> => {
  const mode = track.source === platform ? "byId" : "byQuery";
  // QM lyric 接口要数字 songID
  const lookupId = platform === "qqmusic" ? (track.extId ?? track.id) : track.id;
  const resp =
    mode === "byId"
      ? await window.api.lyrics.matchById(platform, lookupId)
      : await window.api.lyrics.matchByQuery(platform, track);
  if (!resp.ok || !resp.data) return null;
  const data = resp.data;
  return {
    source: { source: "online", format: data.format, platform: data.platform },
    input: {
      content: data.content,
      translation: data.translation,
      translationFormat: data.translationFormat,
      romaji: data.romaji,
      romajiFormat: data.romajiFormat,
    },
  };
};

/**
 * 是否对该平台尝试 TTML 升级
 * @param platform - 平台
 * @param mainFormat - 主格式
 */
const shouldTryTTML = (
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

/** 平台主格式可达列表 */
const PLATFORM_MAIN_FORMATS: Record<Platform, LyricFormat[]> = {
  netease: ["yrc", "lrc"],
  qqmusic: ["qrc", "lrc"],
  kugou: ["krc", "lrc"],
};

/**
 * 判断在指定平台是否能拿到比本地更优的主格式
 * 用于「智能选择 - 优先在线」预筛
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

/**
 * TTML 异步升级
 * @param token - 竞态 token
 * @param track - 歌曲信息
 */
const tryTTMLOverlay = async (token: number, track: Track): Promise<void> => {
  const order = useSettingsStore().lyric.lyricSourceOrder ?? DEFAULT_LYRIC_SOURCE_ORDER;
  const candidates = order.filter(
    (p): p is "netease" | "qqmusic" => p === "netease" || p === "qqmusic",
  );
  if (candidates.length === 0) return;
  const responses = await Promise.all(
    candidates.map((p) => window.api.lyrics.fetchTTMLOverlay(track, p)),
  );
  if (token !== currentToken) return;
  for (let i = 0; i < candidates.length; i++) {
    const resp = responses[i];
    if (resp.ok && resp.data) {
      const platform = candidates[i];
      commit(token, { source: "online", format: "ttml", platform }, { content: resp.data });
      return;
    }
  }
};

/**
 * 获取在线歌词
 * - self：本地歌曲不走第三方；在线歌曲查自家平台
 * - auto + 已有本地：默认不走；smartPreferOnline 开启时按格式优先级筛选可升级平台
 * - auto + 无本地：默认首个命中即返回；smartPreferOnline 开启时按 lyricFormatOrder 跨平台取格式最优
 * - 指定平台：查该平台
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param hasLocal - 是否有本地歌词
 * @param localFormat - 本地歌词格式
 * @returns 在线歌词结果
 */
const tryOnlineByPreference = async (
  token: number,
  track: Track,
  hasLocal: boolean,
  localFormat: LyricFormat | null,
): Promise<OnlineResult | null> => {
  const settings = useSettingsStore();
  const preference = settings.lyric.lyricSourcePreference;
  if (preference === "self") {
    // 在线歌曲
    if (isPlatform(track.source)) {
      return fetchFromPlatform(track.source, track);
    }
    return null;
  }
  if (preference === "auto") {
    const order = settings.lyric.lyricSourceOrder ?? DEFAULT_LYRIC_SOURCE_ORDER;
    const formatOrder = settings.lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
    let candidates: Platform[] = [...order];
    if (hasLocal) {
      if (!settings.lyric.smartPreferOnline || !localFormat) return null;
      candidates = order.filter((p) => platformCanUpgrade(p, localFormat, formatOrder));
      if (candidates.length === 0) return null;
    }
    // smart：并行拉所有候选，谁先回有内容就先 commit，后到的 rank 更高才替换
    if (settings.lyric.smartPreferOnline) {
      let best: OnlineResult | null = null;
      const localIdx = hasLocal && localFormat ? formatOrder.indexOf(localFormat) : -1;
      let bestRank = localIdx === -1 ? Infinity : localIdx;
      await Promise.all(
        candidates.map(async (platform) => {
          const result = await fetchFromPlatform(platform, track);
          if (token !== currentToken || !result) return;
          const idx = formatOrder.indexOf(result.source.format);
          const rank = idx === -1 ? Infinity : idx;
          if (rank < bestRank) {
            best = result;
            bestRank = rank;
            commit(token, result.source, result.input);
          }
        }),
      );
      if (token !== currentToken) return null;
      return best;
    }
    // 其它：按音源顺序首个有效即返回
    for (const platform of candidates) {
      const result = await fetchFromPlatform(platform, track);
      if (token !== currentToken) return null;
      if (!result) continue;
      if (hasLocal && localFormat && !isOnlineResultUpgrade(result, localFormat)) continue;
      return result;
    }
    return null;
  }
  return fetchFromPlatform(preference, track);
};

/**
 * 提交歌词
 * @param token - 竞态 token
 * @param source - 歌词源
 * @param input - 歌词内容
 */
const commit = (token: number, source: LyricData, input: LyricInput | null): void => {
  if (token !== currentToken) return;
  useMediaStore().setLyric(source, input);
};

/** 本地歌词读取结果 */
type LocalLyric = { source: NonNullable<LyricData>; content: string };

/** 提交本地歌词 */
const commitLocal = (token: number, local: LocalLyric): void => {
  commit(token, local.source, { content: local.content });
};

/**
 * 提交在线歌词；解析后为空时优先回退本地，本地也无再按需 TTML 升级
 */
const applyOnline = async (
  token: number,
  track: Track,
  online: OnlineResult,
  fallbackLocal: LocalLyric | null,
): Promise<void> => {
  const media = useMediaStore();
  const current = media.activeLyric;
  // 跳过同源同格式
  const alreadyCommitted =
    current?.source === "online" &&
    current.platform === online.source.platform &&
    current.format === online.source.format;
  if (!alreadyCommitted) {
    commit(token, online.source, online.input);
    if (token !== currentToken) return;
  }
  if (media.parsedLyric.length === 0) {
    if (fallbackLocal) {
      commitLocal(token, fallbackLocal);
      return;
    }
  }
  if (shouldTryTTML(online.source.platform, online.source.format)) {
    await tryTTMLOverlay(token, track);
  }
};

/** 开启新一轮加载周期 */
export const beginLoad = (): number => {
  currentToken++;
  useMediaStore().resetLyricState();
  return currentToken;
};

/**
 * 为当前 track 加载歌词
 *
 * 1. 无 track：commit null 收尾
 * 2. 在线歌曲：
 *    - 默认顺序下，track.platform 与候选平台一致时走 matchById
 *    - 不一致则走 matchByQuery
 * 3. 本地歌曲：本地有先立即 commit 显示；再按偏好查在线，命中热替换
 * 4. 本地 + 在线都无：commit null 收尾 loading
 *
 * @param detail - 歌曲详细信息
 */
export const loadForTrack = async (detail: TrackDetail | null): Promise<void> => {
  const token = beginLoad();
  try {
    const media = useMediaStore();
    const track = media.track;
    // 无 track
    if (!track) {
      commit(token, null, null);
      return;
    }
    // 在线歌曲（任一在线平台）
    if (isPlatform(track.source)) {
      const online = await tryOnlineByPreference(token, track, false, null);
      if (token !== currentToken) return;
      if (online) await applyOnline(token, track, online, null);
      else commit(token, null, null);
      return;
    }
    // 流媒体服务器
    if (track.source === "streaming") {
      const text = await useStreamingStore().getLyrics(track);
      if (token !== currentToken) return;
      const embeddedFallback = detail?.embeddedLyric
        ? {
            source: { source: "embedded" as const, format: detectFormat(detail.embeddedLyric) },
            content: detail.embeddedLyric,
          }
        : null;
      if (text && text.trim()) {
        // 服务器可能给行级 LRC，也可能给逐字（ttml/yrc/qrc 等）或纯文本（Jellyfin 非同步）
        commit(token, { source: "external", format: detectFormat(text) }, { content: text });
        if (token !== currentToken) return;
        // 解析后无有效行（如 Jellyfin 纯文本被 parseLRC 丢弃）→ 回退 embedded
        if (useMediaStore().parsedLyric.length > 0) return;
      }
      if (embeddedFallback) {
        commit(token, embeddedFallback.source, { content: embeddedFallback.content });
      } else {
        commit(token, null, null);
      }
      return;
    }
    // 本地文件
    const local = detail ? await readLocal(detail) : null;
    if (token !== currentToken) return;
    // 本地立即显示
    if (local) commitLocal(token, local);
    // 本地文件存在但解析后空
    const hasUsableLocal = !!local && media.parsedLyric.length > 0;
    const localFormat = local?.source.format ?? null;
    // 按偏好获取歌词
    const online = await tryOnlineByPreference(token, track, hasUsableLocal, localFormat);
    if (token !== currentToken) return;
    if (online) {
      await applyOnline(token, track, online, local);
    } else if (!hasUsableLocal) {
      commit(token, null, null);
    }
  } catch (err) {
    console.error("[lyricLoader] loadForTrack failed:", err);
    commit(token, null, null);
  }
};

/** 偏好变化时的刷新 */
const refreshPreference = async (): Promise<void> => {
  currentToken++;
  const token = currentToken;
  const media = useMediaStore();
  const track = media.track;
  if (!track || track.source === "streaming") return;
  // 在线歌曲（任一在线平台）
  if (isPlatform(track.source)) {
    const online = await tryOnlineByPreference(token, track, false, null);
    if (token !== currentToken) return;
    if (online) await applyOnline(token, track, online, null);
    else commit(token, null, null);
    return;
  }
  // 本地歌曲
  const detail = media.detail;
  const local = detail ? await readLocal(detail) : null;
  if (token !== currentToken) return;
  const localFormat = local?.source.format ?? null;
  const showingOnline = media.activeLyric?.source === "online";
  /** 按偏好获取歌词 */
  const online = await tryOnlineByPreference(token, track, !!local, localFormat);
  if (token !== currentToken) return;
  if (online) {
    await applyOnline(token, track, online, local);
    return;
  }
  // 目标是本地
  if (!showingOnline) return;
  if (local) commitLocal(token, local);
  else commit(token, null, null);
};

/** 监听歌词偏好变化 */
export const watchLyricPreference = (): void => {
  const settings = useSettingsStore();
  watch(
    () => [
      settings.lyric.lyricSourcePreference,
      settings.lyric.smartPreferOnline,
      settings.system.lyric.enableOnlineTTMLLyric,
    ],
    () => {
      refreshPreference();
    },
  );
};
