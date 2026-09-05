/**
 * 当前歌曲歌词加载服务
 */

import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricFormat, LyricInput } from "@shared/types/lyrics";
import { isPlatform } from "@shared/types/platform";
import { bestExternalIndex, parseLyric } from "@/utils/lyric/parse";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { DEFAULT_LYRIC_FORMAT_ORDER } from "@/types/settings";
import {
  embeddedLyricFromDetail,
  isBetterFormat,
  isPluginLyricPreferred,
  resolveLocalRepoLyric,
  resolveOnlineByPreference,
  resolvePluginLyric,
  resolveStreamingByPreference,
  resolveTTMLOverlay,
  type LocalLyric,
  type OnlineResult,
  type ResolvedLyric,
} from "@/services/lyric/resolve";
import { consumePreloadedLyric } from "@/services/lyric/preload";

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
 * 验证歌词是否能够有效解析出行内容
 * @param input - 歌词输入
 * @param format - 歌词格式
 * @returns 是否包含至少一行有效歌词
 */
const hasParseableContent = (input: LyricInput, format: LyricFormat): boolean => {
  try {
    const settings = useSettingsStore();
    const lines = parseLyric(input, format, settings.locale, {
      detectBackground: settings.lyric.detectBackgroundLyrics,
    });
    return lines.length > 0;
  } catch {
    return false;
  }
};

/**
 * 尝试以更优格式提交歌词候选
 * 仅当候选格式优于当前展示格式（或当前无歌词）时写入，避免低优先级结果覆盖优质歌词
 * @param token - 竞态 token
 * @param source - 候选歌词源
 * @param input - 候选歌词内容
 * @returns 是否成功提交且有效解析
 */
const commitIfBetter = (
  token: number,
  source: NonNullable<LyricData>,
  input: LyricInput,
): boolean => {
  if (token !== currentToken) return false;
  const currentFormat = useMediaStore().activeLyric?.format ?? null;
  if (!isBetterFormat(source.format, currentFormat)) return false;
  return commitAndHasParsed(token, source, input);
};

/**
 * 异步拉取 TTML 覆盖并尝试升级当前歌词
 * 非阻塞执行，不阻塞基础歌词展示与其它来源抢占
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param online - 在线歌词基础结果
 */
const tryApplyTTMLOverlay = async (
  token: number,
  track: Track,
  online: OnlineResult,
): Promise<void> => {
  try {
    const ttml = await resolveTTMLOverlay(track, online);
    if (token !== currentToken || !ttml) return;
    const currentFormat = useMediaStore().activeLyric?.format ?? null;
    if (isBetterFormat("ttml", currentFormat)) {
      if (!hasParseableContent(ttml.input, "ttml")) {
        console.warn("[lyricLoader] TTML 解析有效行为空，保留当前歌词");
        return;
      }
      commit(token, ttml.source, ttml.input);
    }
  } catch (err) {
    console.warn("[lyricLoader] tryApplyTTMLOverlay failed:", err);
  }
};

/**
 * 提交在线歌词；解析后为空时优先回退本地，并在后台异步尝试 TTML 升级
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param online - 在线歌词结果
 * @param fallbackLocal - 本地回退歌词
 */
const applyOnline = (
  token: number,
  track: Track,
  online: OnlineResult,
  fallbackLocal: LocalLyric | null,
): void => {
  const media = useMediaStore();
  const current = media.activeLyric;
  const currentFormat = current?.format ?? null;
  // 跳过同源同格式
  const alreadyCommitted =
    current?.source === "online" &&
    current.platform === online.source.platform &&
    current.format === online.source.format;
  if (!alreadyCommitted && isBetterFormat(online.source.format, currentFormat)) {
    if (!commitAndHasParsed(token, online.source, online.input) && fallbackLocal) {
      commitLocal(token, fallbackLocal);
      return;
    }
    if (token !== currentToken) return;
  } else if (media.parsedLyric.length === 0 && fallbackLocal) {
    commitLocal(token, fallbackLocal);
    return;
  }
  void tryApplyTTMLOverlay(token, track, online);
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
  // 插件优选时不处理
  if (isPluginLyricPreferred()) return false;
  const resolved = await resolvePluginLyric(track);
  if (token !== currentToken) return false;
  return resolved ? commitResolvedAndHasParsed(token, resolved) : false;
};

/**
 * 插件优先加载
 * 插件请求与正常流程并发发出，任意一方就绪且更优时立即抢占展示
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param run - 正常加载流程
 */
const withPluginPrefer = async (
  token: number,
  track: Track,
  run: () => Promise<void>,
): Promise<void> => {
  if (!isPluginLyricPreferred()) {
    await run();
    return;
  }

  /**
   * 尝试提交插件歌词
   * 插件任务完成后立即尝试抢占；正常流程结束后再次保底检查，确保最优格式最终展示
   * @param plugin - 解析出的插件歌词，不存在则忽略
   */
  const tryCommitPlugin = (plugin: ResolvedLyric | null): void => {
    if (!plugin || token !== currentToken) return;
    const currentFormat = useMediaStore().activeLyric?.format ?? null;
    if (isBetterFormat(plugin.source.format, currentFormat)) {
      commitResolvedAndHasParsed(token, plugin);
    }
  };

  const pluginTask = resolvePluginLyric(track).then((plugin) => {
    tryCommitPlugin(plugin);
    return plugin;
  });
  await run();
  const plugin = await pluginTask;
  tryCommitPlugin(plugin);
};

/**
 * 流媒体歌词加载：按来源偏好解析，失败后使用插件和内嵌歌词兜底
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param detail - 歌曲详细信息
 */
const loadStreamingLyric = (
  token: number,
  track: Track,
  detail: TrackDetail | null,
): Promise<void> =>
  withPluginPrefer(token, track, async () => {
    const resolved = await resolveStreamingByPreference(track, () => token === currentToken);
    if (token !== currentToken) return;
    const embeddedFallback = embeddedLyricFromDetail(detail);
    if (resolved) {
      const currentFormat = useMediaStore().activeLyric?.format ?? null;
      if (isBetterFormat(resolved.source.format, currentFormat)) {
        if (commitResolvedAndHasParsed(token, resolved)) {
          if (resolved.source.source === "online") {
            void tryApplyTTMLOverlay(token, track, {
              source: resolved.source as OnlineResult["source"],
              input: resolved.input,
            });
          }
          return;
        }
      }
    }
    if (token !== currentToken) return;
    if (await tryPluginFallback(token, track)) return;
    if (embeddedFallback) {
      commit(token, embeddedFallback.source, { content: embeddedFallback.content });
    } else {
      commit(token, null, null);
    }
  });

/**
 * 在线平台歌曲歌词加载
 * @param token - 竞态 token
 * @param track - 歌曲信息
 */
const loadPlatformLyric = (token: number, track: Track): Promise<void> =>
  withPluginPrefer(token, track, async () => {
    const online = await resolveOnlineByPreference(track, {
      hasLocal: false,
      localFormat: null,
      shouldContinue: () => token === currentToken,
    });
    if (token !== currentToken) return;
    if (online) applyOnline(token, track, online, null);
    else if (!(await tryPluginFallback(token, track))) commit(token, null, null);
  });

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
    const preloaded = await consumePreloadedLyric(track);
    if (token !== currentToken) return;
    if (preloaded.hit) {
      if (commitResolvedAndHasParsed(token, preloaded.lyric)) {
        if (preloaded.lyric.source.source === "online") {
          void tryApplyTTMLOverlay(token, track, {
            source: preloaded.lyric.source as OnlineResult["source"],
            input: preloaded.lyric.input,
          });
        }
        return;
      }
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

    await withPluginPrefer(token, track, async () => {
      // 按偏好获取歌词
      const online = await resolveOnlineByPreference(track, {
        hasLocal: hasUsableLocal,
        localFormat,
        onCandidate: (result) => commitIfBetter(token, result.source, result.input),
        shouldContinue: () => token === currentToken,
      });
      if (token !== currentToken) return;
      // id 回查本地 TTML 库
      if (online && (await tryLocalRepo(token, track))) return;
      if (online) {
        applyOnline(token, track, online, local);
      } else if (!hasUsableLocal && !(await tryPluginFallback(token, track))) {
        commit(token, null, null);
      }
    });
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

  await withPluginPrefer(token, track, async () => {
    /** 按偏好获取歌词 */
    const online = await resolveOnlineByPreference(track, {
      hasLocal: !!local,
      localFormat,
      onCandidate: (result) => commitIfBetter(token, result.source, result.input),
      shouldContinue: () => token === currentToken,
    });
    if (token !== currentToken) return;
    if (online) {
      applyOnline(token, track, online, local);
      return;
    }
    // 目标是本地
    if (!showingOnline) return;
    if (local) commitLocal(token, local);
    else commit(token, null, null);
  });
};

/** 监听歌词偏好变化 */
export const watchLyricPreference = (): void => {
  const settings = useSettingsStore();
  watch(
    () => [
      settings.lyric.lyricSourcePreference,
      settings.lyric.smartPreferOnline,
      settings.lyric.preferPluginLyric,
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
