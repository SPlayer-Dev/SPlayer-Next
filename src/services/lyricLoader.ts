/**
 * 歌词加载服务
 */

import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricInput } from "@shared/types/lyrics";
import { isPlatform } from "@shared/types/platform";
import { bestExternalIndex } from "@/utils/lyric/parse";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { DEFAULT_LYRIC_FORMAT_ORDER } from "@/types/settings";
import {
  embeddedLyricFromDetail,
  resolveLocalRepoLyric,
  resolveOnlineByPreference,
  resolvePluginLyric,
  resolveStreamingServerLyric,
  resolveTTMLOverlay,
  type LocalLyric,
  type OnlineResult,
  type ResolvedLyric,
} from "@/services/lyricResolve";

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
  return embeddedLyricFromDetail(detail);
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

/** 提交本地歌词 */
const commitLocal = (token: number, local: LocalLyric): void => {
  commit(token, local.source, { content: local.content });
};

/**
 * 提交歌词并返回解析是否有效
 * @param token - 竞态 token
 * @param source - 歌词源
 * @param input - 歌词内容
 */
const commitAndHasParsed = (
  token: number,
  source: NonNullable<LyricData>,
  input: LyricInput,
): boolean => {
  commit(token, source, input);
  if (token !== currentToken) return false;
  return useMediaStore().parsedLyric.length > 0;
};

/** 提交已解析歌词候选并返回是否有效 */
const commitResolvedAndHasParsed = (token: number, resolved: ResolvedLyric): boolean =>
  commitAndHasParsed(token, resolved.source, resolved.input);

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
    if (!commitAndHasParsed(token, online.source, online.input) && fallbackLocal) {
      commitLocal(token, fallbackLocal);
      return;
    }
    if (token !== currentToken) return;
  } else if (media.parsedLyric.length === 0 && fallbackLocal) {
    commitLocal(token, fallbackLocal);
    return;
  }
  const ttml = await resolveTTMLOverlay(track, online);
  if (token !== currentToken) return;
  if (ttml) {
    commit(token, ttml.source, ttml.input);
  }
};

/**
 * 本地 TTML 歌词库匹配：命中即以最高优先级提交，调用方据此跳过在线请求
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @returns 是否命中
 */
const tryLocalRepo = async (token: number, track: Track): Promise<boolean> => {
  const resolved = await resolveLocalRepoLyric(track);
  if (token !== currentToken) return false;
  return resolved ? commitResolvedAndHasParsed(token, resolved) : false;
};

/**
 * 插件兜底匹配歌词：内置平台都没歌词时，向声明 musicLyric 的插件源逐个兜底
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @returns 是否已提交有效歌词
 */
const tryPluginFallback = async (token: number, track: Track): Promise<boolean> => {
  const resolved = await resolvePluginLyric(track);
  if (token !== currentToken) return false;
  return resolved ? commitResolvedAndHasParsed(token, resolved) : false;
};

/**
 * 流媒体歌词加载：优先服务端歌词，失败后复用在线平台匹配与插件兜底
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param detail - 歌曲详细信息
 */
const loadStreamingLyric = async (
  token: number,
  track: Track,
  detail: TrackDetail | null,
): Promise<void> => {
  const serverLyric = await resolveStreamingServerLyric(track);
  if (token !== currentToken) return;
  const embeddedFallback = embeddedLyricFromDetail(detail);
  if (serverLyric) {
    const hasParsed = commitResolvedAndHasParsed(token, serverLyric);
    // 解析后无有效行
    if (hasParsed || token !== currentToken) return;
  }
  const online = await resolveOnlineByPreference(track, {
    hasLocal: false,
    localFormat: null,
    shouldContinue: () => token === currentToken,
  });
  if (token !== currentToken) return;
  if (online) {
    await applyOnline(token, track, online, embeddedFallback);
    return;
  }
  if (await tryPluginFallback(token, track)) return;
  if (embeddedFallback) {
    commit(token, embeddedFallback.source, { content: embeddedFallback.content });
  } else {
    commit(token, null, null);
  }
};

/**
 * 在线平台歌曲歌词加载
 * @param token - 竞态 token
 * @param track - 歌曲信息
 */
const loadPlatformLyric = async (token: number, track: Track): Promise<void> => {
  const online = await resolveOnlineByPreference(track, {
    hasLocal: false,
    localFormat: null,
    shouldContinue: () => token === currentToken,
  });
  if (token !== currentToken) return;
  if (online) await applyOnline(token, track, online, null);
  else if (!(await tryPluginFallback(token, track))) commit(token, null, null);
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
    // 本地 TTML 歌词库最高优先
    if (await tryLocalRepo(token, track)) return;
    if (token !== currentToken) return;
    // 在线歌曲（任一在线平台）
    if (isPlatform(track.source)) {
      await loadPlatformLyric(token, track);
      return;
    }
    // 流媒体服务器
    if (track.source === "streaming") {
      await loadStreamingLyric(token, track, detail);
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
    const online = await resolveOnlineByPreference(track, {
      hasLocal: hasUsableLocal,
      localFormat,
      onCandidate: (result) => commit(token, result.source, result.input),
      shouldContinue: () => token === currentToken,
    });
    if (token !== currentToken) return;
    // id 回查本地 TTML 库
    if (online && (await tryLocalRepo(token, track))) return;
    if (online) {
      await applyOnline(token, track, online, local);
    } else if (!hasUsableLocal && !(await tryPluginFallback(token, track))) {
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
  if (!track) return;
  // 本地 TTML 歌词库最高优先
  if (await tryLocalRepo(token, track)) return;
  if (token !== currentToken) return;
  if (track.source === "streaming") {
    await loadStreamingLyric(token, track, media.detail);
    return;
  }
  // 在线歌曲（任一在线平台）
  if (isPlatform(track.source)) {
    await loadPlatformLyric(token, track);
    return;
  }
  // 本地歌曲
  const detail = media.detail;
  const local = detail ? await readLocal(detail) : null;
  if (token !== currentToken) return;
  const localFormat = local?.source.format ?? null;
  const showingOnline = media.activeLyric?.source === "online";
  /** 按偏好获取歌词 */
  const online = await resolveOnlineByPreference(track, {
    hasLocal: !!local,
    localFormat,
    onCandidate: (result) => commit(token, result.source, result.input),
    shouldContinue: () => token === currentToken,
  });
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
      settings.lyric.detectBackgroundLyrics,
      settings.system.lyric.enableOnlineTTMLLyric,
      settings.system.localLyric.enableLocalTTMLOverride,
      settings.system.localLyric.repoDir,
    ],
    () => {
      refreshPreference();
    },
  );
};
