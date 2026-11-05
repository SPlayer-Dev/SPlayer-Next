/**
 * 当前歌曲歌词加载服务
 */

import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricFormat, LyricInput } from "lyric-kit";
import type { LyricData } from "@shared/types/lyrics";

import { isPlatform } from "@shared/types/platform";
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
 * 从外部歌词列表中选出最优格式的索引
 * @param lyrics - 外部歌词列表
 * @param priority - 自定义格式优先级
 * @returns 最优格式的索引，无可用歌词时返回 -1
 */
const bestExternalIndex = (
  lyrics: { format: LyricFormat }[],
  priority?: readonly LyricFormat[],
): number => {
  if (lyrics.length === 0) return -1;
  const order = priority && priority.length > 0 ? priority : DEFAULT_LYRIC_FORMAT_ORDER;
  let bestIdx = 0;
  let bestPriority = order.length;
  for (let i = 0; i < lyrics.length; i++) {
    const p = order.indexOf(lyrics[i].format);
    const rank = p === -1 ? order.length : p;
    if (rank < bestPriority) {
      bestPriority = rank;
      bestIdx = i;
    }
  }
  return bestIdx;
};

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

/** 本地歌词转为候选结构，用作在线歌词的验证基准 */
const localToResolved = (local: LocalLyric): ResolvedLyric => ({
  source: local.source,
  input: { content: local.content },
});

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
 * 尝试以更优格式提交歌词候选
 * 仅当候选格式优于当前展示格式（或当前无歌词）时写入，避免低优先级结果覆盖优质歌词；
 * 若写入后有效行为空但此前已有歌词，则自动恢复此前歌词
 * @param token - 竞态 token
 * @param source - 候选歌词源
 * @param input - 候选歌词内容
 * @returns 是否成功提交且有效展示
 */
const commitIfBetter = (
  token: number,
  source: NonNullable<LyricData>,
  input: LyricInput,
): boolean => {
  if (token !== currentToken) return false;
  const media = useMediaStore();
  const currentFormat = media.activeLyric?.format ?? null;
  if (currentFormat && !isBetterFormat(source.format, currentFormat)) {
    return false;
  }

  const prevSource = media.activeLyric;
  const prevInput = media.lyricContent;

  commit(token, source, input);

  if (media.parsedLyric.length > 0) {
    return true;
  }

  // 失败回滚，此前无歌词时也要清掉，否则空结果的格式会挡住后续来源
  media.setLyric(prevSource, prevInput);
  return false;
};

/** 当前 token 是否已触发过 TTML 拉取 */
let ttmlTriggeredToken = -1;

/**
 * 异步静默获取 TTML 覆盖并尝试升级
 * 非阻塞执行，不阻塞基础歌词展示与其它来源抢占
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param mainFormat - 当前主歌词格式，没有歌词时为 null
 */
const applyTTMLOverlay = (token: number, track: Track, mainFormat: LyricFormat | null): void => {
  resolveTTMLOverlay(track, mainFormat)
    .then((ttml) => {
      if (token !== currentToken || !ttml) return;
      commitIfBetter(token, ttml.source, ttml.input);
    })
    .catch((err) => {
      console.warn("[lyricLoader] applyTTMLOverlay failed:", err);
    });
};

/**
 * 本地歌曲按当前展示的歌词获取 TTML 覆盖，不等在线匹配
 * @param token - 竞态 token
 * @param track - 歌曲信息
 */
const applyLocalTTMLOverlay = (token: number, track: Track): void => {
  const media = useMediaStore();
  const shownFormat = media.parsedLyric.length > 0 ? (media.activeLyric?.format ?? null) : null;
  // 关闭在线优先时不覆盖已有歌词
  if (shownFormat && !useSettingsStore().lyric.smartPreferOnline) return;
  applyTTMLOverlay(token, track, shownFormat);
};

/**
 * 在线歌词就绪后触发 TTML 覆盖，同一轮加载只触发一次
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param mainFormat - 当前主歌词格式
 */
const tryApplyTTMLOverlay = (token: number, track: Track, mainFormat: LyricFormat): void => {
  if (token !== currentToken || ttmlTriggeredToken === token) return;
  ttmlTriggeredToken = token;
  applyTTMLOverlay(token, track, mainFormat);
};

/**
 * 提交歌词候选，在线歌词上屏后在后台尝试 TTML 升级
 * @param token - 竞态 token
 * @param track - 歌曲信息
 * @param lyric - 歌词候选
 */
const commitCandidate = (token: number, track: Track, lyric: ResolvedLyric): void => {
  if (commitIfBetter(token, lyric.source, lyric.input) && lyric.source.source === "online") {
    tryApplyTTMLOverlay(token, track, lyric.source.format);
  }
};

/**
 * 提交在线歌词
 * 若成功则在后台异步触发 TTML 升级，解析后为空时优先回退本地
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
  const alreadyCommitted =
    current?.source === "online" &&
    current.platform === online.source.platform &&
    current.format === online.source.format;
  // 已经提交过在线歌词，检查是否需要回退本地或触发 TTML 覆盖
  if (alreadyCommitted) {
    if (media.parsedLyric.length === 0 && fallbackLocal) {
      commitLocal(token, fallbackLocal);
      return;
    }
    tryApplyTTMLOverlay(token, track, online.source.format);
    return;
  }
  // 尝试提交在线歌词
  const preference = useSettingsStore().lyric.lyricSourcePreference;
  // 仅自动模式是智能选择，其余（含跟随自身）均为用户显式指令，来源权威高于格式优劣
  const isExplicit = preference !== "auto";
  // 自动模式下，若当前已展示更优歌词（如候选抢占或插件优选），不降级覆盖
  if (!isExplicit && current && !isBetterFormat(online.source.format, current.format)) {
    return;
  }
  // 尝试提交在线歌词，若失败则回退本地
  if (!commitAndHasParsed(token, online.source, online.input)) {
    if (fallbackLocal && media.parsedLyric.length === 0) {
      commitLocal(token, fallbackLocal);
    }
    return;
  }
  // 尝试触发 TTML 覆盖
  tryApplyTTMLOverlay(token, track, online.source.format);
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
  const pluginTask = resolvePluginLyric(track).then((plugin) => {
    if (plugin && token === currentToken) {
      commitIfBetter(token, plugin.source, plugin.input);
    }
  });
  await run();
  await pluginTask;
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
    const resolved = await resolveStreamingByPreference(track, {
      onCandidate: (lyric) => commitCandidate(token, track, lyric),
      shouldContinue: () => token === currentToken,
    });
    if (token !== currentToken) return;
    const embeddedFallback = embeddedLyricFromDetail(detail);
    if (resolved) commitCandidate(token, track, resolved);
    if (token !== currentToken || useMediaStore().parsedLyric.length > 0) return;
    if (await tryPluginFallback(token, track)) return;
    if (embeddedFallback) {
      commitIfBetter(token, embeddedFallback.source, { content: embeddedFallback.content });
    } else if (useMediaStore().parsedLyric.length === 0) {
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
      onCandidate: (lyric) => commitCandidate(token, track, lyric),
      shouldContinue: () => token === currentToken,
    });
    if (token !== currentToken) return;
    if (online) applyOnline(token, track, online, null);
    else if (useMediaStore().parsedLyric.length === 0 && !(await tryPluginFallback(token, track))) {
      commit(token, null, null);
    }
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
    const preloaded = consumePreloadedLyric(track);
    if (preloaded.hit) commitCandidate(token, track, preloaded.lyric);
    // 本地 TTML 歌词库最高优先
    if (await tryLocalRepo(token, track)) return;
    if (token !== currentToken) return;
    if (track.source === "plugin") {
      const plugin = await resolvePluginLyric(track);
      if (token !== currentToken) return;
      if (plugin) commitIfBetter(token, plugin.source, plugin.input);
      else if (media.parsedLyric.length === 0) commit(token, null, null);
      return;
    }
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
    // 在线匹配后拿到平台 ID 会再查一次
    applyLocalTTMLOverlay(token, track);

    await withPluginPrefer(token, track, async () => {
      // 按偏好获取歌词
      const online = await resolveOnlineByPreference(track, {
        local: hasUsableLocal ? localToResolved(local) : null,
        onCandidate: (lyric) => commitCandidate(token, track, lyric),
        shouldContinue: () => token === currentToken,
      });
      if (token !== currentToken) return;
      // id 回查本地 TTML 库
      if (online && (await tryLocalRepo(token, track))) return;
      if (online) {
        // TTML 先到时不被基础歌词盖掉
        if (media.activeLyric?.source === "online" && media.activeLyric.format === "ttml") return;
        applyOnline(token, track, online, local);
      } else if (
        !hasUsableLocal &&
        useMediaStore().parsedLyric.length === 0 &&
        !(await tryPluginFallback(token, track))
      ) {
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
  if (track.source === "plugin") {
    const plugin = await resolvePluginLyric(track);
    if (token !== currentToken) return;
    if (plugin) commitIfBetter(token, plugin.source, plugin.input);
    else commit(token, null, null);
    return;
  }
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
  const showingOnline = media.activeLyric?.source === "online";

  await withPluginPrefer(token, track, async () => {
    /** 按偏好获取歌词 */
    const online = await resolveOnlineByPreference(track, {
      local: local && localToResolved(local),
      onCandidate: (lyric) => commitCandidate(token, track, lyric),
      shouldContinue: () => token === currentToken,
    });
    if (token !== currentToken) return;
    if (online) {
      applyOnline(token, track, online, local);
      return;
    }
    // 目标是本地
    if (showingOnline) {
      if (local) commitLocal(token, local);
      else commit(token, null, null);
    }
    applyLocalTTMLOverlay(token, track);
  });
};

/** 监听歌词偏好变化 */
export const watchLyricPreference = (): void => {
  const settings = useSettingsStore();
  watch(
    () => [
      settings.lyric.lyricSourcePreference,
      settings.lyric.lyricSourceOrder.join(","),
      settings.lyric.lyricFormatOrder.join(","),
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
