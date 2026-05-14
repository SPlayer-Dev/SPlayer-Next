/**
 * 搜索歌曲（KG）
 *
 * 主路径：mobilecdn.kugou.com/api/v3/search/song
 *   公网无鉴权 GET，响应字段是小写，含 trans_param.union_cover（封面 URL，带 `{size}` 占位）
 *   tramhao/termusic、zonemeen/musicn、UnblockNeteaseMusic 等多个开源项目都在用
 * 兜底：songsearch.kugou.com/song_search_v2（无封面，PascalCase 字段）
 *
 * params:
 * - keywords  关键词（必填）
 * - page      页码，默认 1
 * - limit     每页数，默认 30
 *
 * 返回结构沿用 qqmusic.search（duration 为毫秒），并带 KG 特有的 hash + 多品质 sizes/hashes
 */

import { KG_MOBILECDN_URL, KG_SEARCH_URL, decodeName, formatSingerName } from "../core/config";
import { kgRequest } from "../core/request";
import { coreLog } from "@main/utils/logger";
import type { KGModule } from "../core/types";

type Quality = "128k" | "320k" | "flac" | "flac24bit";

interface NormalizedSong {
  id: string;
  audioId: number;
  hash: string;
  name: string;
  artist: string;
  album: string;
  albumId: string | number;
  cover?: string;
  coverOriginal?: string;
  /** 秒 */
  interval: number;
  /** 毫秒 */
  duration: number;
  qualities: Quality[];
  hashes: Partial<Record<Quality, string>>;
  sizes: Partial<Record<Quality, number>>;
}

/** trans_param.union_cover 含 `{size}` 占位，按需替换 */
const fillCover = (url: string | undefined, size: number): string | undefined => {
  if (!url) return undefined;
  return url.replace(/\{size\}/g, String(size));
};

/** 主路径 mobilecdn 返回的字段都是小写蛇形 */
interface MobileSong {
  hash?: string;
  audio_id?: number;
  songname?: string;
  filename?: string;
  singername?: string;
  album_id?: string | number;
  album_name?: string;
  duration?: number;
  filesize?: number;
  "320hash"?: string;
  "320filesize"?: number;
  sqhash?: string;
  sqfilesize?: number;
  /** Hi-Res 字段名不同版本不一，两种都收 */
  hires_hash?: string;
  hires_filesize?: number;
  reshash?: string;
  resfilesize?: number;
  /** 翻唱/不同版本聚合 */
  group?: MobileSong[];
  trans_param?: { union_cover?: string };
}

interface MobileResp {
  status?: number;
  error_code?: number;
  data?: {
    total?: number;
    info?: MobileSong[];
  };
}

/** singername 是 "A、B" / "A,B" 形式的字符串，规范成 "A / B" */
const formatMobileArtist = (name: string | undefined): string => {
  if (!name) return "";
  return decodeName(name)
    .split(/、|,|;|\//)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" / ");
};

const normalizeFromMobile = (raw: MobileSong): NormalizedSong => {
  const sizes: Partial<Record<Quality, number>> = {};
  const hashes: Partial<Record<Quality, string>> = {};

  if (raw.filesize && raw.hash) {
    sizes["128k"] = raw.filesize;
    hashes["128k"] = raw.hash;
  }
  if (raw["320filesize"] && raw["320hash"]) {
    sizes["320k"] = raw["320filesize"];
    hashes["320k"] = raw["320hash"];
  }
  if (raw.sqfilesize && raw.sqhash) {
    sizes.flac = raw.sqfilesize;
    hashes.flac = raw.sqhash;
  }
  const hrSize = raw.hires_filesize ?? raw.resfilesize;
  const hrHash = raw.hires_hash ?? raw.reshash;
  if (hrSize && hrHash) {
    sizes.flac24bit = hrSize;
    hashes.flac24bit = hrHash;
  }

  const interval = raw.duration ?? 0;
  const coverTpl = raw.trans_param?.union_cover;
  return {
    id: String(raw.audio_id ?? ""),
    audioId: raw.audio_id ?? 0,
    hash: raw.hash ?? "",
    name: decodeName(raw.songname || raw.filename || ""),
    artist: formatMobileArtist(raw.singername),
    album: decodeName(raw.album_name ?? ""),
    albumId: raw.album_id ?? "",
    cover: fillCover(coverTpl, 300),
    coverOriginal: fillCover(coverTpl, 480),
    interval,
    duration: interval * 1000,
    qualities: Object.keys(hashes) as Quality[],
    hashes,
    sizes,
  };
};

const searchSongsMobile = async (keywords: string, page: number, limit: number) => {
  const url =
    `${KG_MOBILECDN_URL}?keyword=${encodeURIComponent(keywords)}` +
    `&page=${page}&pagesize=${limit}&format=json&showtype=1`;

  const body = await kgRequest<MobileResp>(url);
  const raw = body.data?.info ?? [];

  const songs: NormalizedSong[] = [];
  const seen = new Set<string>();
  const push = (item: MobileSong) => {
    const key = `${item.audio_id ?? ""}_${item.hash ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    songs.push(normalizeFromMobile(item));
  };
  for (const item of raw) {
    push(item);
    for (const sub of item.group ?? []) push(sub);
  }

  return {
    code: 200,
    total: body.data?.total ?? songs.length,
    songs,
  };
};

// ── 兜底：旧 songsearch（无封面，PascalCase 字段） ─────────────────────────────

interface LegacySong {
  Audioid: number;
  SongName: string;
  Singers?: Array<{ name?: string }>;
  AlbumName?: string;
  AlbumID?: number | string;
  Duration: number;
  FileHash: string;
  FileSize: number;
  HQFileHash?: string;
  HQFileSize?: number;
  SQFileHash?: string;
  SQFileSize?: number;
  ResFileHash?: string;
  ResFileSize?: number;
  Grp?: LegacySong[];
}

interface LegacyResp {
  status?: number;
  error_code?: number;
  data?: {
    total?: number;
    lists?: LegacySong[];
  };
}

const normalizeFromLegacy = (raw: LegacySong): NormalizedSong => {
  const sizes: Partial<Record<Quality, number>> = {};
  const hashes: Partial<Record<Quality, string>> = {};

  if (raw.FileSize) {
    sizes["128k"] = raw.FileSize;
    hashes["128k"] = raw.FileHash;
  }
  if (raw.HQFileSize && raw.HQFileHash) {
    sizes["320k"] = raw.HQFileSize;
    hashes["320k"] = raw.HQFileHash;
  }
  if (raw.SQFileSize && raw.SQFileHash) {
    sizes.flac = raw.SQFileSize;
    hashes.flac = raw.SQFileHash;
  }
  if (raw.ResFileSize && raw.ResFileHash) {
    sizes.flac24bit = raw.ResFileSize;
    hashes.flac24bit = raw.ResFileHash;
  }

  return {
    id: String(raw.Audioid),
    audioId: raw.Audioid,
    hash: raw.FileHash,
    name: decodeName(raw.SongName),
    artist: formatSingerName(raw.Singers),
    album: decodeName(raw.AlbumName ?? ""),
    albumId: raw.AlbumID ?? "",
    cover: undefined,
    interval: raw.Duration,
    duration: raw.Duration * 1000,
    qualities: Object.keys(hashes) as Quality[],
    hashes,
    sizes,
  };
};

const searchSongsLegacy = async (keywords: string, page: number, limit: number) => {
  const url =
    `${KG_SEARCH_URL}?keyword=${encodeURIComponent(keywords)}` +
    `&page=${page}&pagesize=${limit}` +
    `&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`;

  const body = await kgRequest<LegacyResp>(url);
  const raw = body.data?.lists ?? [];
  const songs: NormalizedSong[] = [];
  const seen = new Set<string>();
  const push = (item: LegacySong) => {
    const key = `${item.Audioid}_${item.FileHash}`;
    if (seen.has(key)) return;
    seen.add(key);
    songs.push(normalizeFromLegacy(item));
  };
  for (const item of raw) {
    push(item);
    for (const sub of item.Grp ?? []) push(sub);
  }

  return {
    code: 200,
    total: body.data?.total ?? songs.length,
    songs,
  };
};

const search: KGModule = async (params) => {
  const {
    keywords,
    page = 1,
    limit = 30,
  } = params as {
    keywords?: string;
    page?: number;
    limit?: number;
  };

  if (!keywords) {
    return { code: 400, total: 0, songs: [], message: "keywords required" };
  }

  // mobilecdn 抛错或空结果都兜底到 songsearch
  try {
    const result = await searchSongsMobile(keywords, page, limit);
    if (result.songs.length > 0) return result;
    coreLog.warn("[kg] mobilecdn returned 0, fallback to songsearch");
  } catch (err) {
    coreLog.warn("[kg] mobilecdn failed, fallback to songsearch:", err);
  }
  return await searchSongsLegacy(keywords, page, limit);
};

export default search;
