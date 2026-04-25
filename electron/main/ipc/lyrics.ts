/**
 * 歌词匹配 IPC
 *
 * - lyrics:matchById(platform, id)       按 id 直取
 * - lyrics:matchByQuery(platform, track)  按 Track 元数据模糊搜索
 *
 * 同 key 的并发请求会被 dedup：连按多次切歌只发一次网络。
 */

import { ipcMain } from "electron";
import * as netease from "@main/apis/common/lyric/netease";
import * as qqmusic from "@main/apis/common/lyric/qqmusic";
import * as kugou from "@main/apis/common/lyric/kugou";
import { coreLog } from "@main/utils/logger";
import type { LyricMatchResponse } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import type { Track } from "@shared/types/player";

/** 进行中请求映射 */
const inflight = new Map<string, Promise<LyricMatchResponse>>();

/**
 * 并发去重
 * @param key 唯一键，相同 key 的并发请求共用同一个 Promise
 * @param run 实际执行函数
 */
const dedup = (
  key: string,
  run: () => Promise<LyricMatchResponse>,
): Promise<LyricMatchResponse> => {
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = run().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
};

/** 按 (platform, id) 直取 */
const resolveById = async (platform: Platform, id: string): Promise<LyricMatchResponse> => {
  try {
    switch (platform) {
      case "netease":
        return { ok: true, data: await netease.getByPlatformId(id) };
      case "qqmusic":
        return { ok: true, data: await qqmusic.getByPlatformId(id) };
      case "kugou":
        return { ok: true, data: await kugou.getByPlatformId(id) };
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
    }
  } catch (err) {
    coreLog.warn(`[lyrics] matchByQuery(${platform}, ${track.title}) failed:`, err);
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
};
