/**
 * 本地 TTML 歌词库
 *
 * 用户指定一个目录作为 TTML 歌词仓库。按需扫描目录下所有 .ttml，解析 AMLL
 * `<amll:meta>` 头（musicName / artists / ncmMusicId / qqMusicId）建立索引：
 * - 平台 id（网易云 / QQ）→ 文件路径（精确命中）
 * - 归一化「标题|首艺术家」→ 文件路径（模糊命中）
 * 命中返回文件原文，交由渲染层 parseTTML 解析。
 *
 * 索引以（目录, 目录 mtime）为缓存边界：目录或其 mtime 变化（增删文件）时重建。
 * 仅保留路径与小键，不驻留文件内容；命中时按需读盘。
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { store } from "@main/store";
import { normalize } from "@main/apis/common/lyric/utils";
import { coreLog } from "@main/utils/logger";
import type { Track } from "@shared/types/player";

interface RepoIndex {
  byNcm: Map<string, string>;
  byQq: Map<string, string>;
  byName: Map<string, string>;
}

interface IndexCache {
  dir: string;
  mtimeMs: number;
  index: RepoIndex;
}

let cache: IndexCache | null = null;
let building: Promise<RepoIndex | null> | null = null;

/** 归一化「标题|首艺术家」匹配键 */
const nameKey = (title: string, artist: string): string =>
  `${normalize(title)}|${normalize(artist)}`;

/** 从 TTML 文本头部提取 AMLL 元信息 */
const extractMeta = (
  text: string,
): { name?: string; artist?: string; ncmId?: string; qqId?: string } => {
  const bodyAt = text.indexOf("<body");
  const head = bodyAt > 0 ? text.slice(0, bodyAt) : text.slice(0, 8000);
  const meta: { name?: string; artist?: string; ncmId?: string; qqId?: string } = {};
  for (const tag of head.matchAll(/<amll:meta\b[^>]*>/gi)) {
    const key = tag[0].match(/\bkey="([^"]*)"/)?.[1];
    const value = tag[0].match(/\bvalue="([^"]*)"/)?.[1];
    if (!key || !value) continue;
    if (key === "musicName" && !meta.name) meta.name = value;
    else if (key === "artists" && !meta.artist) meta.artist = value;
    else if (key === "ncmMusicId" && !meta.ncmId) meta.ncmId = value;
    else if (key === "qqMusicId" && !meta.qqId) meta.qqId = value;
  }
  return meta;
};

/** 递归收集目录下所有 .ttml 文件 */
const collectTtml = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".ttml") out.push(full);
    }
  };
  await walk(dir);
  return out;
};

/** 扫描目录建立索引 */
const buildIndex = async (dir: string): Promise<RepoIndex> => {
  const index: RepoIndex = { byNcm: new Map(), byQq: new Map(), byName: new Map() };
  const files = await collectTtml(dir);
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const meta = extractMeta(text);
    if (meta.ncmId && !index.byNcm.has(meta.ncmId)) index.byNcm.set(meta.ncmId, file);
    if (meta.qqId && !index.byQq.has(meta.qqId)) index.byQq.set(meta.qqId, file);
    if (meta.name) {
      const key = nameKey(meta.name, meta.artist ?? "");
      if (!index.byName.has(key)) index.byName.set(key, file);
    }
  }
  coreLog.info(`[localLyric] 索引完成：${files.length} 个文件 @ ${dir}`);
  return index;
};

/** 取当前生效索引；目录或 mtime 变化时懒重建 */
const getIndex = async (): Promise<RepoIndex | null> => {
  const dir = store.get("localLyric.repoDir") || "";
  if (!dir) return null;
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(dir)).mtimeMs;
  } catch {
    return null;
  }
  if (cache && cache.dir === dir && cache.mtimeMs === mtimeMs) return cache.index;
  if (building) return building;
  building = (async () => {
    try {
      const index = await buildIndex(dir);
      cache = { dir, mtimeMs, index };
      return index;
    } catch (err) {
      coreLog.warn("[localLyric] 索引构建失败：", err);
      return null;
    } finally {
      building = null;
    }
  })();
  return building;
};

/** 读取文件，失败返回 null */
const tryRead = async (file: string | undefined): Promise<string | null> => {
  if (!file) return null;
  try {
    return await readFile(file, "utf-8");
  } catch {
    return null;
  }
};

/**
 * 在本地 TTML 歌词库中匹配当前歌曲
 * @param track - 歌曲信息
 * @returns 命中的 TTML 原文，未命中返回 null
 */
export const matchLocalTTML = async (track: Track): Promise<string | null> => {
  if (!store.get("localLyric.enableLocalTTMLOverride")) return null;
  const index = await getIndex();
  if (!index) return null;
  // 平台 id 精确命中
  if (track.source === "netease") {
    const hit = await tryRead(index.byNcm.get(track.id));
    if (hit) return hit;
  }
  if (track.source === "qqmusic") {
    for (const candidate of [track.extId, track.id]) {
      if (!candidate) continue;
      const hit = await tryRead(index.byQq.get(candidate));
      if (hit) return hit;
    }
  }
  // 标题 + 首艺术家 模糊命中
  return tryRead(index.byName.get(nameKey(track.title, track.artists[0]?.name ?? "")));
};
