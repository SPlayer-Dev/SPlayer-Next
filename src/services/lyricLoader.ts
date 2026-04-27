/**
 * 歌词加载服务
 */

import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricFormat, LyricInput } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import { bestExternalIndex, detectFormat } from "@/utils/lyric/parse";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
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
  const mode = track.platform === platform ? "byId" : "byQuery";
  const resp =
    mode === "byId"
      ? await window.api.lyrics.matchById(platform, track.id)
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
 * 条件：① 平台支持 TTML（netease/qqmusic）② 总开关已开 ③ 格式优先级里 ttml 排在主格式之前
 */
const shouldTryTTML = (
  platform: Platform,
  mainFormat: LyricFormat,
): platform is "netease" | "qqmusic" => {
  if (platform !== "netease" && platform !== "qqmusic") return false;
  if (!useSettingsStore().system.lyric.enableOnlineTTMLLyric) return false;
  const order = useSettingsStore().lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const ttmlIdx = order.indexOf("ttml");
  if (ttmlIdx === -1) return false;
  const mainIdx = order.indexOf(mainFormat);
  if (mainIdx === -1) return true;
  return ttmlIdx < mainIdx;
};

/**
 * TTML 异步升级
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param platform - 平台
 * @returns 是否成功
 */
const tryTTMLOverlay = async (
  token: number,
  track: Track,
  platform: "netease" | "qqmusic",
): Promise<void> => {
  const resp = await window.api.lyrics.fetchTTMLOverlay(track, platform);
  if (token !== currentToken) return;
  if (!resp.ok || !resp.data) return;
  commit(token, { source: "online", format: "ttml", platform }, { content: resp.data });
};

/**
 * 获取在线歌词
 * - self：不走第三方
 * - auto + 已有本地：不走第三方（本地优先）
 * - auto + 无本地：按 AUTO_FALLBACK_ORDER 顺序试，首个命中即返回
 * - 指定平台：查该平台
 */
const tryOnlineByPreference = async (
  token: number,
  track: Track,
  hasLocal: boolean,
): Promise<OnlineResult | null> => {
  const preference = useSettingsStore().lyric.lyricSourcePreference;
  if (preference === "self") return null;
  if (preference === "auto") {
    if (hasLocal) return null;
    const order = useSettingsStore().lyric.lyricSourceOrder ?? DEFAULT_LYRIC_SOURCE_ORDER;
    for (const platform of order) {
      const result = await fetchFromPlatform(platform, track);
      if (token !== currentToken) return null;
      if (result) return result;
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
 * 2. 在线歌曲：暂无
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
    // 在线歌曲
    if (track.source === "online") {
      commit(token, null, null);
      return;
    }
    // 本地文件
    const local = detail ? await readLocal(detail) : null;
    if (token !== currentToken) return;
    // 本地立即显示
    if (local) commit(token, local.source, { content: local.content });
    // 按偏好获取歌词
    const online = await tryOnlineByPreference(token, track, !!local);
    if (token !== currentToken) return;
    if (online) {
      commit(token, online.source, online.input);
      if (shouldTryTTML(online.source.platform, online.source.format)) {
        await tryTTMLOverlay(token, track, online.source.platform);
      }
    } else if (!local) {
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
  if (!track || track.source === "online") return;

  const detail = media.detail;
  const local = detail ? await readLocal(detail) : null;
  if (token !== currentToken) return;
  const preference = useSettingsStore().lyric.lyricSourcePreference;
  const showingOnline = media.activeLyric?.source === "online";

  // 目标应当显示本地
  const shouldShowLocal = preference === "self" || (preference === "auto" && !!local);
  if (shouldShowLocal) {
    if (!showingOnline) return;
    if (local) {
      commit(token, local.source, { content: local.content });
    } else {
      commit(token, null, null);
    }
    return;
  }

  // 其它情况需要查在线
  const online = await tryOnlineByPreference(token, track, !!local);
  if (token !== currentToken) return;
  if (online) {
    commit(token, online.source, online.input);
    if (shouldTryTTML(online.source.platform, online.source.format)) {
      await tryTTMLOverlay(token, track, online.source.platform);
    }
  } else if (local) {
    // 在线失败：回退到本地
    commit(token, local.source, { content: local.content });
  } else {
    // 在线失败 + 无本地：清空旧歌词
    commit(token, null, null);
  }
};

/**
 * 监听歌词偏好变化（来源、音源排序、格式排序），触发刷新
 */
export const watchLyricPreference = (): void => {
  const settings = useSettingsStore();
  watch(
    () => [
      settings.lyric.lyricSourcePreference,
      settings.lyric.lyricSourceOrder,
      settings.lyric.lyricFormatOrder,
    ],
    () => {
      refreshPreference();
    },
    { deep: true },
  );
};
