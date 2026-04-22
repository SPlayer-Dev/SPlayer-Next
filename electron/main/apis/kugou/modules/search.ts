/**
 * 搜索歌曲（KG）
 * endpoint: https://songsearch.kugou.com/song_search_v2
 *
 * params:
 * - keywords  关键词（必填）
 * - page      页码，默认 1
 * - limit     每页数，默认 30
 *
 * 返回字段遵循 qqmusic.search 的结构（duration 为毫秒），并额外带上
 * KG 特有的 hash / audioId / 多品质 sizes&hashes，播放/歌词都要用
 */

import { KG_SEARCH_URL, decodeName, formatSingerName } from "../core/config";
import { kgRequest } from "../core/request";
import type { KGModule } from "../core/types";

interface KGSearchSong {
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
  Grp?: KGSearchSong[];
}

interface KGSearchResp {
  status?: number;
  error_code?: number;
  data?: {
    total?: number;
    lists?: KGSearchSong[];
  };
}

type Quality = "128k" | "320k" | "flac" | "flac24bit";

const normalizeSong = (raw: KGSearchSong) => {
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
    /** 秒 */
    interval: raw.Duration,
    /** 毫秒，与其它源对齐 */
    duration: raw.Duration * 1000,
    /** 支持的品质列表（从高到低） */
    qualities: Object.keys(hashes) as Quality[],
    hashes,
    sizes,
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

  const url =
    `${KG_SEARCH_URL}?keyword=${encodeURIComponent(keywords)}` +
    `&page=${page}&pagesize=${limit}` +
    `&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`;

  const body = await kgRequest<KGSearchResp>(url);

  const raw = body.data?.lists ?? [];
  const songs: ReturnType<typeof normalizeSong>[] = [];
  // 去重键：audioId + hash（同一首歌不同品质会出现多条）
  const seen = new Set<string>();

  const push = (item: KGSearchSong) => {
    const key = `${item.Audioid}_${item.FileHash}`;
    if (seen.has(key)) return;
    seen.add(key);
    songs.push(normalizeSong(item));
  };

  for (const item of raw) {
    push(item);
    // Grp 里是翻唱/不同版本，一并展开
    for (const sub of item.Grp ?? []) push(sub);
  }

  return {
    code: 200,
    total: body.data?.total ?? songs.length,
    songs,
  };
};

export default search;
