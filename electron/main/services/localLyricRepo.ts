/**
 * 本地 TTML 歌词库
 *
 * 用户指定一个目录作为 TTML 歌词仓库。按需扫描目录下所有 .ttml，解析 AMLL
 * `<amll:meta>` 头建立索引：
 * - 平台标识（ISRC / Apple Music / 网易云 / QQ）→ 文件路径（精确命中）
 * - 归一化标题（支持多语种别名）→ 候选列表
 * 命中返回文件原文，交由渲染层 parseTTML 解析。
 *
 * 索引以（目录, 目录 mtime）为缓存边界：目录或其 mtime 变化（增删文件）时重建。
 * 仅保留路径与小键，不驻留文件内容；命中时按需读盘。
 */

import { readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { readFileAutoEncoding } from "@main/utils/encoding";
import { store } from "@main/store";
import {
  normalize,
  normalizeTrackArtists,
  artistMatches,
  bothContains,
} from "@main/apis/common/lyric/utils";
import { buildFingerprint, getMatchedId } from "@main/database/lyricMatchCache";
import { coreLog } from "@main/utils/logger";
import type { Track } from "@shared/types/player";
import type { LocalLyricMatchLevel } from "@shared/types/settings";

/** 同名候选 */
interface NameCandidate {
  /** 候选艺术家列表（支持多语种别名），供拆分比对 */
  artists: string[];
  /** 候选专辑列表（支持多专辑收录），供比对 */
  albums: string[];
  file: string;
}

interface RepoIndex {
  byNcm: Map<string, string>;
  byQq: Map<string, string>;
  byAppleMusic: Map<string, string>;
  byIsrc: Map<string, string>;
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

interface ExtractedMeta {
  names: string[];
  artists: string[];
  albums: string[];
  ncmIds: string[];
  qqIds: string[];
  appleMusicIds: string[];
  isrcs: string[];
}

/** 从 TTML 文本头部提取 AMLL 元信息，支持多别名、Apple Music ID 与 ISRC */
const extractMeta = (text: string): ExtractedMeta => {
  const bodyAt = text.indexOf("<body");
  const head = bodyAt > 0 ? text.slice(0, bodyAt) : text.slice(0, 8000);
  const meta: ExtractedMeta = {
    names: [],
    artists: [],
    albums: [],
    ncmIds: [],
    qqIds: [],
    appleMusicIds: [],
    isrcs: [],
  };

  for (const tag of head.matchAll(/<amll:meta\b[^>]*>/gi)) {
    const key = tag[0].match(/\bkey="([^"]*)"/)?.[1];
    const rawVal = tag[0].match(/\bvalue="([^"]*)"/)?.[1];
    if (!key || !rawVal) continue;
    const value = rawVal.trim();
    if (!value) continue;

    if (key === "musicName" || key === "title") {
      if (!meta.names.includes(value)) meta.names.push(value);
    } else if (key === "artists" || key === "artist") {
      if (!meta.artists.includes(value)) meta.artists.push(value);
    } else if (key === "album" || key === "albumName" || key === "albumTitle") {
      if (!meta.albums.includes(value)) meta.albums.push(value);
    } else if (key === "ncmMusicId" || key === "ncmId") {
      if (!meta.ncmIds.includes(value)) meta.ncmIds.push(value);
    } else if (key === "qqMusicId" || key === "qqId") {
      if (!meta.qqIds.includes(value)) meta.qqIds.push(value);
    } else if (
      key === "appleMusicId" ||
      key === "appleMusicTrackId" ||
      key === "itunesId" ||
      key === "adamId"
    ) {
      if (!meta.appleMusicIds.includes(value)) meta.appleMusicIds.push(value);
    } else if (key === "isrc") {
      const isrcNorm = value.toUpperCase();
      if (!meta.isrcs.includes(isrcNorm)) meta.isrcs.push(isrcNorm);
    }
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
  const index: RepoIndex = {
    byNcm: new Map(),
    byQq: new Map(),
    byAppleMusic: new Map(),
    byIsrc: new Map(),
    byTitle: new Map(),
  };
  const files = await collectTtml(dir);
  for (const file of files) {
    let text: string;
    try {
      text = await readFileAutoEncoding(file);
    } catch {
      continue;
    }
    const meta = extractMeta(text);
    for (const ncmId of meta.ncmIds) {
      if (!index.byNcm.has(ncmId)) index.byNcm.set(ncmId, file);
    }
    for (const qqId of meta.qqIds) {
      if (!index.byQq.has(qqId)) index.byQq.set(qqId, file);
    }
    for (const amId of meta.appleMusicIds) {
      if (!index.byAppleMusic.has(amId)) index.byAppleMusic.set(amId, file);
    }
    for (const isrc of meta.isrcs) {
      if (!index.byIsrc.has(isrc)) index.byIsrc.set(isrc, file);
    }

    if (meta.names.length > 0) {
      const candidate: NameCandidate = {
        artists: meta.artists,
        albums: meta.albums,
        file,
      };
      const seenTitles = new Set<string>();
      for (const name of meta.names) {
        const titleKey = normalize(name);
        if (!titleKey || seenTitles.has(titleKey)) continue;
        seenTitles.add(titleKey);
        const list = index.byTitle.get(titleKey);
        if (list) list.push(candidate);
        else index.byTitle.set(titleKey, [candidate]);
      }
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
 * 根据匹配强度从同名候选列表中挑选最匹配的文件
 * @param candidates - 同一标题下的候选列表
 * @param track - 目标歌曲
 * @param level - 匹配强度 (strict | standard | loose)
 * @returns 命中文件路径，未命中返回 null
 */
const pickCandidate = (
  candidates: NameCandidate[],
  track: Track,
  level: LocalLyricMatchLevel,
): string | null => {
  const trackArtists = normalizeTrackArtists(track);
  const trackAlbum = normalize(track.album?.name);

  // 宽松模式：保持原有容错，多候选时按艺术家和专辑打分挑最优；都无匹配兜底首个
  if (level === "loose") {
    if (candidates.length === 1 || trackArtists.length === 0) return candidates[0].file;
    let best = candidates[0];
    let bestScore = -1;
    for (const candidate of candidates) {
      let score = 0;
      let matchExact = false;
      let matchContains = false;
      for (const candArtist of candidate.artists) {
        const artist = artistMatches(candArtist, trackArtists);
        if (artist.exact) matchExact = true;
        if (artist.contains) matchContains = true;
      }
      if (matchExact) score += 100;
      else if (matchContains) score += 50;

      if (trackAlbum && candidate.albums.length > 0) {
        for (const candAlbumRaw of candidate.albums) {
          const candAlbum = normalize(candAlbumRaw);
          if (!candAlbum) continue;
          if (candAlbum === trackAlbum) {
            score += 20;
            break;
          }
          if (bothContains(candAlbum, trackAlbum)) {
            score += 10;
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best.file;
  }

  // 严格模式：必须歌曲与候选均有艺术家且严格一致，若双方均有专辑则专辑也必须一致
  if (level === "strict") {
    if (trackArtists.length === 0) return null;
    let best: NameCandidate | null = null;
    let bestScore = -1;

    for (const candidate of candidates) {
      let matchExact = false;
      for (const candArtist of candidate.artists) {
        if (artistMatches(candArtist, trackArtists).exact) {
          matchExact = true;
          break;
        }
      }
      if (!matchExact) continue;

      let albumScore = 0;
      if (trackAlbum && candidate.albums.length > 0) {
        let hasExactAlbum = false;
        let hasContainsAlbum = false;
        for (const candAlbumRaw of candidate.albums) {
          const candAlbum = normalize(candAlbumRaw);
          if (!candAlbum) continue;
          if (candAlbum === trackAlbum) {
            hasExactAlbum = true;
            break;
          }
          if (bothContains(candAlbum, trackAlbum)) {
            hasContainsAlbum = true;
          }
        }
        if (hasExactAlbum) {
          albumScore = 20;
        } else if (hasContainsAlbum) {
          albumScore = 10;
        } else {
          continue; // 双方均有专辑但均不匹配，严格模式直接排除
        }
      }

      const score = 100 + albumScore;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best ? best.file : null;
  }

  // 标准模式 (standard，默认)：必须艺术家匹配；多候选根据艺术家与专辑匹配度综合择优
  let best: NameCandidate | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    let matchExact = false;
    let matchContains = false;
    for (const candArtist of candidate.artists) {
      const artist = artistMatches(candArtist, trackArtists);
      if (artist.exact) matchExact = true;
      if (artist.contains) matchContains = true;
    }

    let score = 0;
    if (trackArtists.length > 0) {
      if (matchExact) score = 100;
      else if (matchContains) score = 60;
      else if (candidate.artists.length === 0)
        score = 20; // 候选缺少艺术家，容错
      else continue; // 双方均有艺术家且不匹配，坚决拒绝兜底
    } else {
      score = 20; // 目标歌曲无艺术家，容错
    }

    if (trackAlbum && candidate.albums.length > 0) {
      let matchedAlbumScore = -10;
      for (const candAlbumRaw of candidate.albums) {
        const candAlbum = normalize(candAlbumRaw);
        if (!candAlbum) continue;
        if (candAlbum === trackAlbum) {
          matchedAlbumScore = Math.max(matchedAlbumScore, 30);
          break;
        }
        if (bothContains(candAlbum, trackAlbum)) {
          matchedAlbumScore = Math.max(matchedAlbumScore, 15);
        }
      }
      score += matchedAlbumScore;
    }

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best ? best.file : null;
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

  const matchLevel = (store.get("localLyric.matchLevel") as LocalLyricMatchLevel) || "standard";

  // ISRC 全球唯一录音编码精确命中（跨平台最高置信度）
  if (track.isrc) {
    const isrcKey = track.isrc.trim().toUpperCase();
    const hit = await tryRead(index.byIsrc.get(isrcKey));
    if (hit) return hit;
  }

  // Apple Music ID 精确命中
  const isAppleMusic =
    (track.source as string) === "appleMusic" || (track.source as string) === "applemusic";
  if (isAppleMusic) {
    for (const idCandidate of [track.id, track.extId]) {
      if (!idCandidate) continue;
      const hit = await tryRead(index.byAppleMusic.get(idCandidate));
      if (hit) return hit;
    }
  }
  const amId = (track as { appleMusicId?: string }).appleMusicId;
  if (amId) {
    const hit = await tryRead(index.byAppleMusic.get(amId));
    if (hit) return hit;
  }

  // 网易云平台 ID 精确命中（在线歌曲）
  if (track.source === "netease") {
    const hit = await tryRead(index.byNcm.get(track.id));
    if (hit) return hit;
  }

  // QQ 音乐平台 ID 精确命中（在线歌曲）
  if (track.source === "qqmusic") {
    for (const idCandidate of [track.extId, track.id]) {
      if (!idCandidate) continue;
      const hit = await tryRead(index.byQq.get(idCandidate));
      if (hit) return hit;
    }
  }

  // 标题命中：按匹配强度筛选候选（支持多语种别名标题、艺术家与专辑）
  const candidates = index.byTitle.get(normalize(track.title));
  if (candidates && candidates.length > 0) {
    const picked = pickCandidate(candidates, track, matchLevel);
    if (picked) {
      const hit = await tryRead(picked);
      if (hit) return hit;
    }
  }

  // 兜底：平台 ID 指纹缓存回查
  return matchByCachedId(track, index);
};
