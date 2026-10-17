/**
 * 本地歌词库
 *
 * 用户指定若干目录作为歌词仓库。按需递归扫描其中的 .ttml / .lrc / .lys / .ass / .srt，
 * 解析元信息建立索引：
 * - 文件名里的歌曲 ID（`歌曲ID.后缀名` 或 `任意前缀.歌曲ID.后缀名`）→ 候选文件
 * - TTML 的 AMLL `<amll:meta>` 头（ncmMusicId / qqMusicId，可多个）→ 候选文件
 * - 标题（TTML 的 musicName、LRC / LyS 的 [ti:]）→ 同名候选
 * 命中时返回文件原文，交由渲染层按实际格式解析。
 *
 * 索引以（目录集合, 整棵目录树的 mtime）为缓存边界：目录列表或任一目录（含子目录）
 * 变化（增删文件）时重建。仅保留路径与小键，不驻留文件内容；命中时按需读盘。
 */

import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { readFileAutoEncoding } from "@main/utils/encoding";
import { store } from "@main/store";
import { normalize } from "@main/apis/common/lyric/utils";
import { buildFingerprint, getMatchedId } from "@main/database/lyricMatchCache";
import { coreLog } from "@main/utils/logger";
import { DEFAULT_LYRIC_FORMAT_ORDER } from "@shared/types/lyrics";
import type { LyricFormat } from "lyric-kit";
import type { Track } from "@shared/types/player";

/** 可识别的扩展名与其歌词格式 */
const EXTENSION_FORMATS: Record<string, LyricFormat> = {
  ".ttml": "ttml",
  ".lrc": "lrc",
  ".lys": "lys",
  ".ass": "ass",
  ".srt": "srt",
};

/** 同名候选：艺术家仅作区分，不作硬门槛 */
interface NameCandidate {
  /** 归一化首艺术家，缺失为空串 */
  artist: string;
  file: string;
}

interface RepoIndex {
  /** 文件名里的歌曲 ID → 候选文件 */
  byFileId: Map<string, string[]>;
  byNcm: Map<string, string[]>;
  byQq: Map<string, string[]>;
  /** 归一化标题 → 同名候选 */
  byTitle: Map<string, NameCandidate[]>;
}

interface IndexCache {
  /** 目录集合（含顺序），顺序不同视为不同优先级 */
  dirsKey: string;
  /** 目录签名，见 collectDirSignature */
  signature: number[];
  index: RepoIndex;
}

interface Building {
  /** 发起构建时的目录集合 */
  dirsKey: string;
  task: Promise<RepoIndex | null>;
}

let cache: IndexCache | null = null;
let building: Building | null = null;

interface TTMLMeta {
  name?: string;
  artist?: string;
  ncmIds: string[];
  qqIds: string[];
}

/** 从 TTML 文本头部提取 AMLL 元信息 */
const extractTtmlMeta = (text: string): TTMLMeta => {
  const bodyAt = text.indexOf("<body");
  const head = bodyAt > 0 ? text.slice(0, bodyAt) : text.slice(0, 8000);
  const meta: TTMLMeta = { ncmIds: [], qqIds: [] };
  for (const tag of head.matchAll(/<amll:meta\b[^>]*>/gi)) {
    const key = tag[0].match(/\bkey="([^"]*)"/)?.[1];
    const value = tag[0].match(/\bvalue="([^"]*)"/)?.[1];
    if (!key || !value) continue;
    if (key === "musicName" && !meta.name) meta.name = value;
    else if (key === "artists" && !meta.artist) meta.artist = value;
    else if (key === "ncmMusicId") meta.ncmIds.push(value);
    else if (key === "qqMusicId") meta.qqIds.push(value);
  }
  return meta;
};

/**
 * 取文件名里的歌曲 ID：`歌曲ID.后缀名` 或 `任意前缀.歌曲ID.后缀名`
 * 只认纯数字的平台 ID（网易云的 songId、QQ 音乐的 songId）；QQ 的 songmid 不在此列
 * @param file - 文件路径
 * @returns 全数字 ID，不符合命名规则时返回 null
 */
const idFromFileName = (file: string): string | null => {
  const name = basename(file, extname(file));
  const segment = name.slice(name.lastIndexOf(".") + 1);
  return /^\d+$/.test(segment) ? segment : null;
};

/** 文件在全局歌词格式优先级中的位置，未知格式排最后 */
const formatRank = (file: string): number => {
  const format = EXTENSION_FORMATS[extname(file).toLowerCase()];
  const rank = format ? DEFAULT_LYRIC_FORMAT_ORDER.indexOf(format) : -1;
  return rank === -1 ? DEFAULT_LYRIC_FORMAT_ORDER.length : rank;
};

/** 同 ID / 同名多文件时取格式优先级最高的，同格式保持目录顺序 */
const pickByFormat = (files: string[]): string | undefined => {
  if (files.length === 0) return undefined;
  return [...files].sort((a, b) => formatRank(a) - formatRank(b))[0];
};

/**
 * 同名候选里按艺术家挑出一组；只有一条或无法用艺术家区分时取全部
 * @param candidates - 同一标题下的候选
 * @param wantArtist - 归一化的目标首艺术家
 * @returns 命中的文件路径，未命中返回 undefined
 */
const pickByArtist = (candidates: NameCandidate[], wantArtist: string): string | undefined => {
  if (candidates.length === 0) return undefined;
  if (!wantArtist) return pickByFormat(candidates.map((candidate) => candidate.file));
  const exact = candidates.filter((candidate) => candidate.artist === wantArtist);
  if (exact.length > 0) return pickByFormat(exact.map((candidate) => candidate.file));
  const partial = candidates.filter(
    (candidate) =>
      candidate.artist &&
      (candidate.artist.includes(wantArtist) || wantArtist.includes(candidate.artist)),
  );
  const pool = partial.length > 0 ? partial : candidates;
  return pickByFormat(pool.map((candidate) => candidate.file));
};

/** 头标签扫描范围：LRC / LyS 的元信息都在文件开头，只看开头即可，避免整篇解析 */
const HEAD_SCAN_LENGTH = 4096;

/** 与 lyric-kit 的 LRC 元信息标签规则一致：整行形如 [key:value] */
const HEAD_TAG_RE = /^[ \t]*\[(ti|ar):(.*?)]\s*$/gim;

/**
 * 解析 LRC / LyS 的头标签，取 [ti:] 与 [ar:]
 * @param text - 歌词原文
 * @returns 歌曲名与首艺术家，缺失时为空
 */
const extractTaggedMeta = (text: string): { name?: string; artist?: string } => {
  const meta: { name?: string; artist?: string } = {};
  for (const tag of text.slice(0, HEAD_SCAN_LENGTH).matchAll(HEAD_TAG_RE)) {
    const value = tag[2].trim();
    if (!value) continue;
    if (tag[1].toLowerCase() === "ti") meta.name = value;
    else meta.artist = value;
  }
  return meta;
};

/** 递归收集目录下所有受支持的歌词文件 */
const collectLyricFiles = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort(byName)) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && EXTENSION_FORMATS[extname(entry.name).toLowerCase()])
        out.push(full);
    }
  };
  await walk(dir);
  return out;
};

/** 按名称排序，保证两次遍历顺序一致 */
const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * 目录签名：递归取每个目录自身的 mtime，按固定顺序排列
 *
 * 扫描是递归的，只盯着顶层目录会漏掉子目录里的增删（父目录 mtime 不变），
 * 因此缓存边界必须覆盖整棵目录树；目录不存在时记 -1。
 * @param dirs - 歌词库目录
 * @returns 目录签名
 */
const collectDirSignature = async (dirs: string[]): Promise<number[]> => {
  const signature: number[] = [];
  const visit = async (dir: string): Promise<void> => {
    let mtime: number;
    try {
      mtime = (await stat(dir)).mtimeMs;
    } catch {
      // 目录不存在或读不到时只记 -1，不递归
      signature.push(-1);
      return;
    }
    signature.push(mtime);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort(byName)) {
      if (entry.isDirectory()) await visit(join(dir, entry.name));
    }
  };
  for (const dir of dirs) await visit(dir);
  return signature;
};

/** 追加候选文件，保留先扫到的顺序 */
const pushFile = (map: Map<string, string[]>, key: string, file: string): void => {
  const list = map.get(key);
  if (list) list.push(file);
  else map.set(key, [file]);
};

/** 扫描所有目录建立索引 */
const buildIndex = async (dirs: string[]): Promise<RepoIndex> => {
  const index: RepoIndex = {
    byFileId: new Map(),
    byNcm: new Map(),
    byQq: new Map(),
    byTitle: new Map(),
  };
  const files = (await Promise.all(dirs.map((dir) => collectLyricFiles(dir)))).flat();
  for (const file of files) {
    const format = EXTENSION_FORMATS[extname(file).toLowerCase()];
    if (!format) continue;
    const fileId = idFromFileName(file);
    if (fileId) pushFile(index.byFileId, fileId, file);
    if (format === "ass" || format === "srt") continue;

    let text: string;
    try {
      text = await readFileAutoEncoding(file);
    } catch {
      continue;
    }
    let name: string | undefined;
    let artist: string | undefined;
    if (format === "ttml") {
      const meta = extractTtmlMeta(text);
      for (const id of meta.ncmIds) pushFile(index.byNcm, id, file);
      for (const id of meta.qqIds) pushFile(index.byQq, id, file);
      name = meta.name;
      artist = meta.artist;
    } else {
      const meta = extractTaggedMeta(text);
      name = meta.name;
      artist = meta.artist;
    }
    if (name) {
      const titleKey = normalize(name);
      const candidate: NameCandidate = { artist: normalize(artist ?? ""), file };
      const list = index.byTitle.get(titleKey);
      if (list) list.push(candidate);
      else index.byTitle.set(titleKey, [candidate]);
    }
  }
  coreLog.info(`[localLyric] 索引完成：${files.length} 个文件 @ ${dirs.join(", ")}`);
  return index;
};

/** 当前配置的歌词库目录 */
const getRepoDirs = (): string[] => {
  const dirs = store.get("localLyric.repoDirs") ?? [];
  return dirs.map((dir) => dir.trim()).filter((dir) => dir !== "");
};

/** 目录签名是否一致 */
const sameSignature = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((mtime, index) => mtime === b[index]);

/** 取当前生效索引；目录集合或整棵目录树（含子目录）的 mtime 变化时懒重建 */
const getIndex = async (): Promise<RepoIndex | null> => {
  const dirs = getRepoDirs();
  if (dirs.length === 0) return null;
  const dirsKey = dirs.join("\n");
  const signature = await collectDirSignature(dirs);
  if (signature.every((mtime) => mtime < 0)) return null;
  if (cache && cache.dirsKey === dirsKey && sameSignature(cache.signature, signature)) {
    return cache.index;
  }
  if (building) {
    // 同一批目录的构建直接复用；目录集合刚变过则等它收尾，再按当前集合重建
    if (building.dirsKey === dirsKey) return building.task;
    await building.task;
  }
  const pending: Building = { dirsKey, task: Promise.resolve(null) };
  pending.task = (async () => {
    try {
      const index = await buildIndex(dirs);
      cache = { dirsKey, signature, index };
      return index;
    } catch (err) {
      coreLog.warn("[localLyric] 索引构建失败：", err);
      return null;
    } finally {
      if (building === pending) building = null;
    }
  })();
  building = pending;
  return pending.task;
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

/** 按 ID 候选依次查表，取第一个有候选的 ID */
const lookupFiles = (map: Map<string, string[]>, ids: string[]): string | undefined => {
  for (const id of ids) {
    const files = map.get(id);
    if (files && files.length > 0) return pickByFormat(files);
  }
  return undefined;
};

/** Track 自带的平台 ID 候选；QQ 的 extId 即 mid，优先于数字 id */
const trackIds = (track: Track): string[] => {
  const ids = track.source === "qqmusic" ? [track.extId, track.id] : [track.id, track.extId];
  return ids.filter((id): id is string => !!id);
};

/** 文件名 ID 只认纯数字，QQ mid 等非数字候选留给元信息表 */
const numericIds = (ids: string[]): string[] => ids.filter((id) => /^\d+$/.test(id));

/**
 * 用匹配缓存里在线模糊搜索解析出的平台 id 回查本地库
 * 本地歌首播时没有平台 id、标题也可能对不上，靠在线搜索事后写入的 id 兜底命中
 * @param track - 歌曲信息
 * @param index - 当前索引
 * @returns 命中的歌词原文，未命中返回 null
 */
const matchByCachedId = async (track: Track, index: RepoIndex): Promise<string | null> => {
  const fingerprint = buildFingerprint(track);
  const ncm = getMatchedId(fingerprint, "netease");
  if (ncm) {
    const hit = await tryRead(
      lookupFiles(index.byNcm, [ncm.platformId]) ?? lookupFiles(index.byFileId, [ncm.platformId]),
    );
    if (hit) return hit;
  }
  const qq = getMatchedId(fingerprint, "qqmusic");
  if (qq) {
    const ids = [qq.extra?.mid, qq.platformId].filter((id): id is string => !!id);
    const hit = await tryRead(
      lookupFiles(index.byQq, ids) ?? lookupFiles(index.byFileId, numericIds(ids)),
    );
    if (hit) return hit;
  }
  return null;
};

/**
 * 在本地歌词库中匹配当前歌曲
 * @param track - 歌曲信息
 * @returns 命中的歌词文件原文，未命中返回 null
 */
export const matchLocalLyric = async (track: Track): Promise<string | null> => {
  if (!store.get("localLyric.enableLocalLyricOverride")) return null;
  const index = await getIndex();
  if (!index) return null;
  const ids = trackIds(track);
  // track 自带平台 id 精确命中（在线歌曲）
  const byMetaId =
    track.source === "netease"
      ? lookupFiles(index.byNcm, ids)
      : track.source === "qqmusic"
        ? lookupFiles(index.byQq, ids)
        : undefined;
  const idHit = await tryRead(byMetaId ?? lookupFiles(index.byFileId, numericIds(ids)));
  if (idHit) return idHit;
  // 标题命中；同名多条时再用艺术家软性区分
  const candidates = index.byTitle.get(normalize(track.title)) ?? [];
  const titleHit = await tryRead(pickByArtist(candidates, normalize(track.artists[0]?.name ?? "")));
  if (titleHit) return titleHit;
  // 兜底：平台 id 回查
  return matchByCachedId(track, index);
};
