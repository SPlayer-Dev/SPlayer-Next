import { dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, statSync, readdirSync } from "node:fs";
import { store } from "@main/store";
import {
  defaultAppCacheDir,
  getAppCacheDir,
  getCoverCacheDir,
  getArtistCacheDir,
  getBackgroundsDir,
} from "@main/utils/config";
import { syncCoverCacheDir } from "@main/services/engine";
import { getDb } from "@main/database";
import { clearLyricCache } from "@main/database/lyricCache";
import { clearLyricTtmlCache } from "@main/database/lyricTtmlCache";
import { clearLyricMatchCache } from "@main/database/lyricMatchCache";
import { systemLog } from "@main/utils/logger";

/** 已知的缓存类别 */
export type CacheCategory =
  | "covers"
  | "artists"
  | "backgrounds"
  | "lyric"
  | "lyricTTML"
  | "lyricMatch";

/** 单类别的占用情况 */
export interface CacheStat {
  id: CacheCategory;
  /** 显示用路径或来源；DB 类条目展示表名 */
  path: string;
  size: number;
}

/** 递归累计目录占用 */
const dirSize = (dir: string): number => {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += dirSize(full);
      } else if (entry.isFile()) {
        total += statSync(full).size;
      }
    } catch {}
  }
  return total;
};

/** 清空目录但保留目录本身 */
const clearDir = async (dir: string): Promise<void> => {
  if (!existsSync(dir)) return;
  const entries = await fs.readdir(dir);
  await Promise.all(
    entries.map((name) => fs.rm(path.join(dir, name), { recursive: true, force: true })),
  );
};

/** 目录是否为空（不存在视为空） */
const isDirEmpty = async (dir: string): Promise<boolean> => {
  if (!existsSync(dir)) return true;
  const entries = await fs.readdir(dir);
  return entries.length === 0;
};

/** sqlite 单表占用：取所有 TEXT/BLOB 字段 length 之和 */
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

/** 类别 → 占用统计 / 路径展示 / 清空动作 */
const categoryHandlers: Record<
  CacheCategory,
  { path: () => string; size: () => number; clear: () => void | Promise<void> }
> = {
  covers: {
    path: getCoverCacheDir,
    size: () => dirSize(getCoverCacheDir()),
    clear: () => clearDir(getCoverCacheDir()),
  },
  artists: {
    path: getArtistCacheDir,
    size: () => dirSize(getArtistCacheDir()),
    clear: () => clearDir(getArtistCacheDir()),
  },
  backgrounds: {
    path: getBackgroundsDir,
    size: () => dirSize(getBackgroundsDir()),
    clear: () => clearDir(getBackgroundsDir()),
  },
  lyric: {
    path: () => "lyric_cache",
    size: () => tableSize("lyric_cache", ["data"]),
    clear: clearLyricCache,
  },
  lyricTTML: {
    path: () => "lyric_ttml_cache",
    size: () => tableSize("lyric_ttml_cache", ["content"]),
    clear: clearLyricTtmlCache,
  },
  lyricMatch: {
    path: () => "lyric_match_cache",
    size: () => tableSize("lyric_match_cache", ["fingerprint", "platform_id", "extra"]),
    clear: clearLyricMatchCache,
  },
};

/** 文件类目（受自定义缓存目录影响，切换时需要清空） */
const fileCategories: CacheCategory[] = ["covers", "artists", "backgrounds"];

/** 注册缓存相关 IPC */
export const registerCacheIpc = (): void => {
  ipcMain.handle("cache:getStats", (): CacheStat[] => {
    return (Object.keys(categoryHandlers) as CacheCategory[]).map((id) => ({
      id,
      path: categoryHandlers[id].path(),
      size: categoryHandlers[id].size(),
    }));
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

  ipcMain.handle("cache:clearAll", async (): Promise<void> => {
    await Promise.all(
      (Object.keys(categoryHandlers) as CacheCategory[]).map((id) => categoryHandlers[id].clear()),
    );
    systemLog.info(`[cache] cleared all`);
  });

  ipcMain.handle("cache:getDir", (): string => getAppCacheDir());

  /**
   * 切换缓存目录
   * - 用户必须选择空目录才允许切换
   * - 切换前清空旧目录下的文件类缓存（封面 / 头像 / 背景图）
   * - sqlite 中的歌词等缓存路径独立，不参与本次清空
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
      await Promise.all(fileCategories.map((id) => categoryHandlers[id].clear()));
      store.set("cache.dir", next);
      syncCoverCacheDir();
      systemLog.info(`[cache] dir switched to ${next}`);
      return { ok: true, dir: next };
    },
  );

  /** 还原默认缓存目录（同样清空旧的文件类缓存） */
  ipcMain.handle("cache:resetDir", async (): Promise<string> => {
    await Promise.all(fileCategories.map((id) => categoryHandlers[id].clear()));
    store.set("cache.dir", null);
    syncCoverCacheDir();
    return defaultAppCacheDir;
  });
};
