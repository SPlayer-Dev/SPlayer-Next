import { dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, type Dirent } from "node:fs";
import { store } from "@main/store";
import {
  defaultAppCacheDir,
  getAppCacheDir,
  getCoverCacheDir,
  getArtistCacheDir,
  getBackgroundsDir,
  getSongCacheDir,
} from "@main/utils/config";
import { syncCoverCacheDir } from "@main/services/engine";
import { getDb } from "@main/database";
import { clearLyricCache } from "@main/database/lyricCache";
import { clearLyricTtmlCache } from "@main/database/lyricTtmlCache";
import { clearLyricMatchCache } from "@main/database/lyricMatchCache";
import * as songCache from "@main/services/songCache";
import type { TrackSource } from "@shared/types/player";
import { systemLog } from "@main/utils/logger";

/** 已知的缓存类别 */
export type CacheCategory =
  | "covers"
  | "artists"
  | "backgrounds"
  | "songs"
  | "lyric"
  | "lyricTTML"
  | "lyricMatch";

/** 缓存介质 */
export type CacheKind = "file" | "db";

/** 单类别的占用情况 */
export interface CacheStat {
  id: CacheCategory;
  kind: CacheKind;
  /** 显示用路径或来源 */
  path: string;
  size: number;
}

/**
 * 递归累计目录占用
 * @param dir - 目录路径
 * @returns 占用字节数
 */
const dirSize = async (dir: string): Promise<number> => {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) return await dirSize(full);
        if (entry.isFile()) return (await fs.stat(full)).size;
      } catch {}
      return 0;
    }),
  );
  return sizes.reduce((sum, item) => sum + item, 0);
};

/**
 * 清空目录但保留目录本身
 * @param dir - 目录路径
 */
const clearDir = async (dir: string): Promise<void> => {
  if (!existsSync(dir)) return;
  const entries = await fs.readdir(dir);
  await Promise.all(
    entries.map((name) => fs.rm(path.join(dir, name), { recursive: true, force: true })),
  );
};

/**
 * 目录是否为空（不存在视为空）
 * @param dir - 目录路径
 * @returns 是否为空
 */
const isDirEmpty = async (dir: string): Promise<boolean> => {
  if (!existsSync(dir)) return true;
  const entries = await fs.readdir(dir);
  return entries.length === 0;
};

/**
 * sqlite 单表占用：取所有 TEXT/BLOB 字段 length 之和
 * @param table - 表名
 * @param columns - 列名列表
 * @returns 占用字节数
 */
const tableSize = (table: string, columns: string[]): number => {
  try {
    const expr = columns.map((c) => `COALESCE(length(${c}), 0)`).join(" + ");
    const row = getDb().prepare(`SELECT SUM(${expr}) AS total FROM ${table}`).get() as
      | { total: number | null }
      | undefined;
    return row?.total ?? 0;
  } catch {
    return 0;
  }
};

/**
 * 类别 → 介质 / 占用统计 / 路径展示 / 清空动作
 * @param category - 类别
 * @returns 介质 / 占用统计 / 路径展示 / 清空动作
 */
const categoryHandlers: Record<
  CacheCategory,
  {
    kind: CacheKind;
    path: () => string;
    size: () => number | Promise<number>;
    clear: () => void | Promise<void>;
  }
> = {
  covers: {
    kind: "file",
    path: getCoverCacheDir,
    size: () => dirSize(getCoverCacheDir()),
    clear: () => clearDir(getCoverCacheDir()),
  },
  artists: {
    kind: "file",
    path: getArtistCacheDir,
    size: () => dirSize(getArtistCacheDir()),
    clear: () => clearDir(getArtistCacheDir()),
  },
  backgrounds: {
    kind: "file",
    path: getBackgroundsDir,
    size: () => dirSize(getBackgroundsDir()),
    clear: () => clearDir(getBackgroundsDir()),
  },
  songs: {
    kind: "file",
    path: getSongCacheDir,
    size: () => songCache.stats().size,
    clear: () => songCache.clearAll(),
  },
  lyric: {
    kind: "db",
    path: () => "lyric_cache",
    size: () => tableSize("lyric_cache", ["data"]),
    clear: clearLyricCache,
  },
  lyricTTML: {
    kind: "db",
    path: () => "lyric_ttml_cache",
    size: () => tableSize("lyric_ttml_cache", ["content"]),
    clear: clearLyricTtmlCache,
  },
  lyricMatch: {
    kind: "db",
    path: () => "lyric_match_cache",
    size: () => tableSize("lyric_match_cache", ["fingerprint", "platform_id", "extra"]),
    clear: clearLyricMatchCache,
  },
};

/**
 * 按介质类型获取类别列表
 * @param kind - 介质类型
 * @returns 类别列表
 */
const idsByKind = (kind: CacheKind): CacheCategory[] =>
  (Object.keys(categoryHandlers) as CacheCategory[]).filter(
    (id) => categoryHandlers[id].kind === kind,
  );

/** 注册缓存相关 IPC */
export const registerCacheIpc = (): void => {
  ipcMain.handle("cache:getStats", async (): Promise<CacheStat[]> => {
    const ids = Object.keys(categoryHandlers) as CacheCategory[];
    return Promise.all(
      ids.map(async (id) => ({
        id,
        kind: categoryHandlers[id].kind,
        path: categoryHandlers[id].path(),
        size: await categoryHandlers[id].size(),
      })),
    );
  });

  ipcMain.handle("cache:clear", async (_event, id: CacheCategory): Promise<void> => {
    const handler = categoryHandlers[id];
    if (!handler) return;
    try {
      await handler.clear();
      systemLog.info(`[cache] cleared ${id}`);
    } catch (err) {
      systemLog.error(`[cache] clear ${id} failed`, err);
      throw err;
    }
  });

  /** 一键清空：按介质分桶，避免误删另一类 */
  ipcMain.handle("cache:clearAllByKind", async (_event, kind: CacheKind): Promise<void> => {
    const ids = idsByKind(kind);
    await Promise.all(ids.map((id) => categoryHandlers[id].clear()));
    systemLog.info(`[cache] cleared all (${kind})`);
  });

  ipcMain.handle("cache:getDir", (): string => getAppCacheDir());

  /**
   * 切换缓存目录
   * - 用户必须选择空目录才允许切换
   * - 切换前清空旧目录下的文件类缓存
   */
  ipcMain.handle(
    "cache:pickDir",
    async (): Promise<{ ok: boolean; dir: string; reason?: "canceled" | "notEmpty" }> => {
      const current = getAppCacheDir();
      const result = await dialog.showOpenDialog({
        title: "选择缓存目录",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, dir: current, reason: "canceled" };
      }
      const next = result.filePaths[0];
      if (!(await isDirEmpty(next))) {
        return { ok: false, dir: current, reason: "notEmpty" };
      }
      await Promise.all(idsByKind("file").map((id) => categoryHandlers[id].clear()));
      store.set("cache.dir", next);
      syncCoverCacheDir();
      songCache.reloadDir();
      systemLog.info(`[cache] dir switched to ${next}`);
      return { ok: true, dir: next };
    },
  );

  /** 还原默认缓存目录（同样清空旧的文件类缓存） */
  ipcMain.handle("cache:resetDir", async (): Promise<string> => {
    await Promise.all(idsByKind("file").map((id) => categoryHandlers[id].clear()));
    store.set("cache.dir", null);
    syncCoverCacheDir();
    songCache.reloadDir();
    return defaultAppCacheDir;
  });

  /** 歌曲文件级缓存：命中查询 */
  ipcMain.handle(
    "cache:song:lookup",
    (_event, cacheKey: string): Promise<string | null> => songCache.lookup(cacheKey),
  );

  /** 歌曲文件级缓存：排队下载 */
  ipcMain.handle(
    "cache:song:fetch",
    (_event, cacheKey: string, source: TrackSource, streamUrl: string): Promise<string | null> =>
      songCache.fetchAsync(cacheKey, source, streamUrl),
  );

  /** 歌曲文件级缓存：取消进行中的下载 */
  ipcMain.handle("cache:song:cancel", (_event, cacheKey: string): void => {
    songCache.cancel(cacheKey);
  });
};
