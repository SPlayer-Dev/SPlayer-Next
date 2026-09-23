/**
 * 本地 TTML 歌词库
 *
 * 用户指定一个目录作为 TTML 歌词仓库。按需扫描目录下所有 .ttml，解析 AMLL
 * `<amll:meta>` 头（musicName / artists / ncmMusicId / qqMusicId）建立索引：
 * - 平台 id（网易云 / QQ）→ 文件路径（精确命中）
 * - 归一化标题 → 候选列表
 * 命中返回文件原文，交由渲染层 parseTTML 解析。
 *
 * 索引以（目录, 目录 mtime）为缓存边界：目录或其 mtime 变化（增删文件）时重建。
 * 仅保留路径与小键，不驻留文件内容；命中时按需读盘。
 */

import { readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { readFileAutoEncoding } from "@main/utils/encoding";
import { store } from "@main/store";
import { normalize } from "@main/apis/common/lyric/utils";
import { buildFingerprint, getMatchedId } from "@main/database/lyricMatchCache";
import { coreLog } from "@main/utils/logger";
import type { Track } from "@shared/types/player";

/** 同名候选：艺术家仅作区分，不作硬门槛 */
interface NameCandidate {
  /** 归一化首艺术家，缺失为空串 */
  artist: string;
  file: string;
}

interface RepoIndex {
  byNcm: Map<string, string>;
  byQq: Map<string, string>;
  /** 归一化标题 → 同名候选 */
  byTitle: Map<string, NameCandidate[]>;
}

interface IndexCache {
  dir: string;
  mtimeMs: number;
  index: RepoIndex;
}

let cache: IndexCache | null = null;
let building: Promise<RepoIndex | null> | null = null;

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
  const index: RepoIndex = { byNcm: new Map(), byQq: new Map(), byTitle: new Map() };
  const files = await collectTtml(dir);
  for (const file of files) {
    let text: string;
    try {
      text = await readFileAutoEncoding(file);
    } catch {
      continue;
    }
    const meta = extractMeta(text);
    if (meta.ncmId && !index.byNcm.has(meta.ncmId)) index.byNcm.set(meta.ncmId, file);
    if (meta.qqId && !index.byQq.has(meta.qqId)) index.byQq.set(meta.qqId, file);
    if (meta.name) {
      const titleKey = normalize(meta.name);
      const candidate: NameCandidate = { artist: normalize(meta.artist ?? ""), file };
      const list = index.byTitle.get(titleKey);
      if (list) list.push(candidate);
      else index.byTitle.set(titleKey, [candidate]);
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
    return await readFileAutoEncoding(file);
  } catch {
    return null;
  }
};

/**
 * 同名候选里按艺术家挑最匹配的；只有一条或无法用艺术家区分时取第一条
 * @param candidates - 同一标题下的候选
 * @param wantArtist - 归一化的目标首艺术家
 * @returns 命中文件路径
 */
const pickByArtist = (candidates: NameCandidate[], wantArtist: string): string => {
  if (candidates.length === 1 || !wantArtist) return candidates[0].file;
  const exact = candidates.find((candidate) => candidate.artist === wantArtist);
  if (exact) return exact.file;
  const partial = candidates.find(
    (candidate) =>
      candidate.artist &&
      (candidate.artist.includes(wantArtist) || wantArtist.includes(candidate.artist)),
  );
  return (partial ?? candidates[0]).file;
};

/**
 * 用匹配缓存里在线模糊搜索解析出的平台 id 回查本地库
 * 本地歌首播时没有平台 id、标题也可能对不上，靠在线搜索事后写入的 id 兜底命中
 * @param track - 歌曲信息
 * @param index - 当前索引
 * @returns 命中的 TTML 原文，未命中返回 null
 */
const matchByCachedId = async (track: Track, index: RepoIndex): Promise<string | null> => {
  const fingerprint = buildFingerprint(track);
  const ncm = getMatchedId(fingerprint, "netease");
  if (ncm) {
    const hit = await tryRead(index.byNcm.get(ncm.platformId));
    if (hit) return hit;
  }
  const qq = getMatchedId(fingerprint, "qqmusic");
  if (qq) {
    for (const idCandidate of [qq.extra?.mid, qq.platformId]) {
      if (!idCandidate) continue;
      const hit = await tryRead(index.byQq.get(idCandidate));
      if (hit) return hit;
    }
  }
  return null;
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
  // track 自带平台 id 精确命中（在线歌曲）
  if (track.source === "netease") {
    const hit = await tryRead(index.byNcm.get(track.id));
    if (hit) return hit;
  }
  if (track.source === "qqmusic") {
    for (const idCandidate of [track.extId, track.id]) {
      if (!idCandidate) continue;
      const hit = await tryRead(index.byQq.get(idCandidate));
      if (hit) return hit;
    }
  }
  // 标题命中；同名多条时再用艺术家软性区分
  const candidates = index.byTitle.get(normalize(track.title));
  if (candidates && candidates.length > 0) {
    return tryRead(pickByArtist(candidates, normalize(track.artists[0]?.name ?? "")));
  }
  // 兜底：平台 id 回查
  return matchByCachedId(track, index);
};
