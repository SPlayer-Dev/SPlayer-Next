/**
 * 歌词匹配 IPC
 *
 * - lyrics:matchById(platform, id)         按 id 直取
 * - lyrics:matchByQuery(platform, track)   按 Track 元数据模糊搜索
 * - lyrics:forget/rememberMatch            删除或写入模糊匹配映射
 * - lyrics:fetchTTMLOverlay(track, platform) 抓 AMLL TTML DB 的高质量 TTML
 * - lyrics:searchTTML(track)               按 Track 元数据搜索 AMLL TTML DB
 * - lyrics:searchCandidates(platform, keyword, track) 按关键词搜索手动匹配候选
 * - lyrics:fetchTTMLById(id)               按 AMLL 条目 id 取 TTML
 * - lyrics:get/set/clearManualMatch        读写歌曲的手动选择
 *
 * 同 key 的并发请求会被 dedup：连按多次切歌只发一次网络。
 */

import { ipcMain, dialog } from "electron";
import * as netease from "@main/apis/common/lyric/netease";
import * as qqmusic from "@main/apis/common/lyric/qqmusic";
import * as kugou from "@main/apis/common/lyric/kugou";
import {
  fetchTTML,
  fetchTTMLById,
  searchTTML,
  searchTTMLCandidates,
} from "@main/apis/common/lyric/ttml";
import {
  getCandidateTags,
  pickBestCandidate,
  type LyricCandidate,
} from "@main/apis/common/lyric/utils";
import { matchLocalTTML } from "@main/services/localLyricRepo";
import {
  buildFingerprint,
  deleteMatchedId,
  getMatchedId,
  setMatchedId,
} from "@main/database/lyricMatchCache";
import { clearManualMatch, getManualMatch, setManualMatch } from "@main/database/lyricManualMatch";
import { coreLog } from "@main/utils/logger";
import type {
  LyricManualMatch,
  LyricMatchResponse,
  LyricMatchSource,
  LyricSearchResponse,
  LyricTTMLResponse,
} from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import type { Track } from "@shared/types/player";

/** 进行中请求映射 */
const inflight = new Map<string, Promise<unknown>>();

/**
 * 并发去重
 * @param key 唯一键，相同 key 的并发请求共用同一个 Promise
 * @param run 实际执行函数
 */
const dedup = <T>(key: string, run: () => Promise<T>): Promise<T> => {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = run().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
};

/**
 * 按 (platform, id) 直取
 * @param platform 平台
 * @param id 平台 id
 * @param track 歌曲信息
 * @param prefetch 是否预热 TTML
 * @returns 歌词匹配结果
 */
const resolveById = async (
  platform: Platform,
  id: string,
  track?: Track,
  prefetch?: boolean,
): Promise<LyricMatchResponse> => {
  try {
    switch (platform) {
      case "netease":
        return { ok: true, data: await netease.getByPlatformId(id, prefetch) };
      case "qqmusic":
        return { ok: true, data: await qqmusic.getByPlatformId(id, undefined, prefetch) };
      case "kugou":
        return { ok: true, data: await kugou.getByPlatformId(id, track) };
      default:
        return { ok: false, error: `unsupported platform: ${platform}` };
    }
  } catch (err) {
    coreLog.warn(`[lyrics] matchById(${platform}, ${id}) failed:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/** 按 Track 元数据 fuzzy 匹配 */
const resolveByQuery = async (platform: Platform, track: Track): Promise<LyricMatchResponse> => {
  try {
    switch (platform) {
      case "netease":
        return { ok: true, data: await netease.getByQuery(track) };
      case "qqmusic":
        return { ok: true, data: await qqmusic.getByQuery(track) };
      case "kugou":
        return { ok: true, data: await kugou.getByQuery(track) };
      default:
        return { ok: false, error: `unsupported platform: ${platform}` };
    }
  } catch (err) {
    coreLog.warn(`[lyrics] matchByQuery(${platform}, ${track.title}) failed:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/**
 * 按关键词取某来源的候选，extra 统一为可保存的 id
 * @param source 歌词来源
 * @param keyword 搜索关键词
 * @param track 歌曲信息
 * @returns 候选列表
 */
const searchSource = async (
  source: LyricMatchSource,
  keyword: string,
  track: Track,
): Promise<LyricCandidate<string>[]> => {
  switch (source) {
    case "netease":
      return (await netease.searchCandidates(keyword)).map((song) => ({
        ...song,
        extra: song.extra.id,
      }));
    case "qqmusic":
      return (await qqmusic.searchCandidates(keyword)).map((song) => ({
        ...song,
        extra: song.extra.id,
      }));
    case "kugou":
      return (await kugou.searchCandidates(keyword)).map((song) => ({
        ...song,
        extra: song.extra.hash,
      }));
    case "ttml":
      return searchTTMLCandidates(keyword, track);
  }
};

/**
 * 按关键词搜索候选，并标出它们与歌曲的吻合情况
 * @param platform 歌词来源
 * @param keyword 搜索关键词
 * @param track 歌曲信息
 * @returns 候选列表
 */
const resolveCandidates = async (
  platform: LyricMatchSource,
  keyword: string,
  track: Track,
): Promise<LyricSearchResponse> => {
  try {
    const candidates = await searchSource(platform, keyword, track);
    const best = pickBestCandidate(candidates, track);
    const autoIds =
      platform === "ttml"
        ? []
        : [
            getMatchedId(buildFingerprint(track), platform)?.platformId,
            ...(track.source === platform ? [track.id, track.extId] : []),
          ];
    return {
      ok: true,
      data: candidates.map((candidate) => {
        const { extra, ...song } = candidate;
        return {
          ...song,
          platform,
          id: extra,
          tags: getCandidateTags(candidate, track),
          best: candidate === best,
          // ponytail: 自动 TTML 不记录 AMLL id，按同一打分规则推断，同歌多条目时可能标错
          autoMatched: platform === "ttml" ? candidate === best : autoIds.includes(extra),
        };
      }),
    };
  } catch (err) {
    coreLog.warn(`[lyrics] searchCandidates(${platform}, ${keyword}) failed:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/**
 * 按 Track 解析出对应平台的 TTML 候选 id，依次抓取直至命中。
 * - NCM：track.platform=netease 时用 track.id；其它情况查 match cache 拿数字 id
 * - QM：track.platform=qqmusic 时把 track.id 当数字 id 候选；再叠加 match cache 的 mid + 数字 id
 */
const resolveTTMLOverlay = async (
  track: Track,
  platform: "netease" | "qqmusic",
): Promise<LyricTTMLResponse> => {
  try {
    const ids: string[] = [];
    const push = (v?: string) => {
      if (v && !ids.includes(v)) ids.push(v);
    };
    const fingerprint = buildFingerprint(track);
    const cached = getMatchedId(fingerprint, platform);
    // QM mid 放前面（AMLL DB 早期 QM 条目以 mid 为文件名的居多）
    if (platform === "qqmusic") push(cached?.extra?.mid);
    if (track.source === platform) push(track.id);
    // QM 在线 Track 默认走 byId
    if (track.source === platform) push(track.extId);
    push(cached?.platformId);
    if (ids.length === 0) return { ok: true, data: null };
    return { ok: true, data: await fetchTTML(platform, ids) };
  } catch (err) {
    coreLog.warn(`[lyrics] fetchTTMLOverlay(${platform}, ${track.title}) failed:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

export const registerLyricsIpc = (): void => {
  ipcMain.handle(
    "lyrics:matchById",
    (_evt, platform: Platform, id: string, track?: Track, prefetch?: boolean) =>
      dedup(`byId:${platform}:${id}`, () => resolveById(platform, id, track, prefetch)),
  );
  ipcMain.handle("lyrics:matchByQuery", (_evt, platform: Platform, track: Track) =>
    dedup(`byQuery:${platform}:${track.id}`, () => resolveByQuery(platform, track)),
  );
  ipcMain.handle("lyrics:forgetMatch", (_evt, track: Track, platform: Platform) =>
    deleteMatchedId(buildFingerprint(track), platform),
  );
  ipcMain.handle("lyrics:rememberMatch", (_evt, track: Track, platform: Platform, id: string) =>
    setMatchedId(buildFingerprint(track), platform, id),
  );
  ipcMain.handle(
    "lyrics:searchCandidates",
    (_evt, platform: LyricMatchSource, keyword: string, track: Track) =>
      dedup(`candidates:${platform}:${keyword}:${track.id}`, () =>
        resolveCandidates(platform, keyword, track),
      ),
  );
  ipcMain.handle("lyrics:fetchTTMLById", async (_evt, id: string): Promise<LyricTTMLResponse> => ({
    ok: true,
    data: await fetchTTMLById(id),
  }));
  ipcMain.handle("lyrics:getManualMatch", (_evt, track: Track) => getManualMatch(track));
  ipcMain.handle("lyrics:setManualMatch", (_evt, track: Track, match: LyricManualMatch) =>
    setManualMatch(track, match),
  );
  ipcMain.handle("lyrics:clearManualMatch", (_evt, track: Track) => clearManualMatch(track));
  ipcMain.handle("lyrics:fetchTTMLOverlay", (_evt, track: Track, platform: "netease" | "qqmusic") =>
    dedup(`ttml:${platform}:${track.id}`, () => resolveTTMLOverlay(track, platform)),
  );
  ipcMain.handle("lyrics:searchTTML", (_evt, track: Track) =>
    dedup(`ttmlSearch:${track.id}`, async (): Promise<LyricTTMLResponse> => {
      try {
        return { ok: true, data: await searchTTML(track) };
      } catch (err) {
        coreLog.warn(`[lyrics] searchTTML(${track.title}) failed:`, err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  ipcMain.handle(
    "lyrics:matchLocalTTML",
    async (_evt, track: Track): Promise<LyricTTMLResponse> => {
      try {
        return { ok: true, data: await matchLocalTTML(track) };
      } catch (err) {
        coreLog.warn(`[lyrics] matchLocalTTML(${track.title}) failed:`, err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
  ipcMain.handle("lyrics:pickLyricRepoDir", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: "选择本地 TTML 歌词库目录",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
};
