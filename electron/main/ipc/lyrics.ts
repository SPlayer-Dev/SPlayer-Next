/**
 * 歌词匹配 IPC
 *
 * - lyrics:matchById(platform, id)         按 id 直取
 * - lyrics:matchByQuery(platform, track)   按 Track 元数据模糊搜索
 * - lyrics:fetchTTMLOverlay(track, platform) 抓 AMLL TTML DB 的高质量 TTML
 *
 * 同 key 的并发请求会被 dedup：连按多次切歌只发一次网络。
 */

import { ipcMain } from "electron";
import * as netease from "@main/apis/common/lyric/netease";
import * as qqmusic from "@main/apis/common/lyric/qqmusic";
import * as kugou from "@main/apis/common/lyric/kugou";
import { fetchTTML } from "@main/apis/common/lyric/ttml";
import { buildFingerprint, getMatchedId } from "@main/database/lyricMatchCache";
import { coreLog } from "@main/utils/logger";
import type { LyricMatchResponse, LyricTTMLResponse } from "@shared/types/lyrics";
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
 * @returns 歌词匹配结果
 */
const resolveById = async (platform: Platform, id: string): Promise<LyricMatchResponse> => {
  try {
    switch (platform) {
      case "netease":
        return { ok: true, data: await netease.getByPlatformId(id) };
      case "qqmusic":
        return { ok: true, data: await qqmusic.getByPlatformId(id) };
      case "kugou":
        return { ok: true, data: await kugou.getByPlatformId(id) };
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
    if (track.platform === platform) push(track.id);
    // QM 在线 Track 默认走 byId
    if (track.platform === platform) push(track.extId);
    push(cached?.platformId);
    if (ids.length === 0) return { ok: true, data: null };
    return { ok: true, data: await fetchTTML(platform, ids) };
  } catch (err) {
    coreLog.warn(`[lyrics] fetchTTMLOverlay(${platform}, ${track.title}) failed:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

export const registerLyricsIpc = (): void => {
  ipcMain.handle("lyrics:matchById", (_evt, platform: Platform, id: string) =>
    dedup(`byId:${platform}:${id}`, () => resolveById(platform, id)),
  );
  ipcMain.handle("lyrics:matchByQuery", (_evt, platform: Platform, track: Track) =>
    dedup(`byQuery:${platform}:${track.id}`, () => resolveByQuery(platform, track)),
  );
  ipcMain.handle("lyrics:fetchTTMLOverlay", (_evt, track: Track, platform: "netease" | "qqmusic") =>
    dedup(`ttml:${platform}:${track.id}`, () => resolveTTMLOverlay(track, platform)),
  );
};
