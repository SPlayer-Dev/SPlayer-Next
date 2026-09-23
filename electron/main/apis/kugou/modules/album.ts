/**
 * KG 专辑详情与歌曲列表
 *
 * 接口：
 * - 专辑详情：POST /kmr/v2/albums (openapi.kugou.com) / 兜底 GET http://mobilecdn.kugou.com/api/v3/album/info
 * - 专辑歌曲：POST /v1/album_audio/lite (openapi.kugou.com) / 兜底 GET http://mobilecdn.kugou.com/api/v3/album/song
 */

import { decodeName, fillCover } from "../core/config";
import { kgGatewayRequest, kgRequest } from "../core/request";
import type { KGModule, KGSong, Quality } from "../core/types";

interface RawAlbumDetail {
  album_id?: number | string;
  album_name?: string;
  publish_date?: string;
  sizable_cover?: string;
  intro?: string;
  language?: string;
  author_name?: string;
  authors?: Array<{ author_id?: number | string; author_name?: string }>;
  songcount?: number;
}

interface RawAlbumSongEntry {
  base?: {
    audio_id?: number;
    audio_name?: string;
    album_id?: number | string;
    author_name?: string;
    album_audio_id?: number;
  };
  audio_info?: {
    hash?: string;
    hash_128?: string;
    hash_320?: string;
    hash_flac?: string;
    hash_high?: string;
    filesize?: number;
    filesize_128?: number;
    filesize_320?: number;
    filesize_flac?: number;
    filesize_high?: number;
    duration?: number;
    duration_128?: number;
    duration_320?: number;
    duration_flac?: number;
    duration_high?: number;
  };
  authors?: Array<{ author_id?: number | string; author_name?: string }>;
  album_info?: {
    album_name?: string;
    cover?: string;
  };
  trans_param?: {
    union_cover?: string;
    pay_block_tpl?: number;
  };
  deprecated?: {
    pay_type?: number;
    pkg_price?: number;
    price?: number;
  };
}

interface MobileAlbumInfo {
  albumid?: number | string;
  albumname?: string;
  singername?: string;
  singerid?: number | string;
  imgurl?: string;
  intro?: string;
  publishtime?: string;
  songcount?: number;
}

interface MobileAlbumSong {
  hash?: string;
  audio_id?: number;
  album_audio_id?: number;
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
  hires_hash?: string;
  hires_filesize?: number;
  reshash?: string;
  resfilesize?: number;
  pay_type?: number;
  trans_param?: {
    union_cover?: string;
    pay_block_tpl?: number;
  };
}

const normalizeAlbumSong = (raw: RawAlbumSongEntry, fallbackCover?: string): KGSong => {
  const base = raw.base ?? {};
  const audio = raw.audio_info ?? {};
  const albumInfo = raw.album_info ?? {};
  const authors = raw.authors ?? [];
  const trans = raw.trans_param ?? {};

  const cover = fillCover(albumInfo.cover || trans.union_cover || fallbackCover, 300);
  const coverOriginal = fillCover(albumInfo.cover || trans.union_cover || fallbackCover, 480);
  const duration =
    audio.duration_320 || audio.duration_128 || audio.duration_flac || audio.duration || 0;

  const sizes: Partial<Record<Quality, number>> = {};
  const hashes: Partial<Record<Quality, string>> = {};

  const f128 = audio.filesize_128 ?? audio.filesize;
  const h128 = audio.hash_128 ?? audio.hash;
  if (f128 && h128) {
    sizes["128k"] = f128;
    hashes["128k"] = h128;
  }
  if (audio.filesize_320 && audio.hash_320) {
    sizes["320k"] = audio.filesize_320;
    hashes["320k"] = audio.hash_320;
  }
  if (audio.filesize_flac && audio.hash_flac) {
    sizes.flac = audio.filesize_flac;
    hashes.flac = audio.hash_flac;
  }
  if (audio.filesize_high && audio.hash_high) {
    sizes.flac24bit = audio.filesize_high;
    hashes.flac24bit = audio.hash_high;
  }

  const artistStr =
    authors
      .map((a) => a.author_name)
      .filter(Boolean)
      .join(" / ") ||
    base.author_name ||
    "";

  const artists = authors.length
    ? authors.map((a) => ({
        id: a.author_id !== undefined ? String(a.author_id) : undefined,
        name: decodeName(a.author_name || ""),
      }))
    : [{ name: decodeName(artistStr) }];

  const artistId = authors[0]?.author_id !== undefined ? String(authors[0].author_id) : undefined;

  return {
    id: String(base.audio_id || audio.hash || ""),
    audioId: base.audio_id ?? 0,
    albumAudioId: base.album_audio_id,
    hash: audio.hash_128 || audio.hash || "",
    name: decodeName(base.audio_name || ""),
    artist: decodeName(artistStr),
    artistId,
    artists,
    album: decodeName(albumInfo.album_name || ""),
    albumId: base.album_id ?? "",
    cover,
    coverOriginal,
    interval: Math.round(duration / 1000),
    duration,
    qualities: Object.keys(hashes) as Quality[],
    hashes,
    sizes,
    pay: {
      payplay: raw.deprecated?.pay_type ?? 0,
      pkg_price: raw.deprecated?.pkg_price ?? (raw.deprecated?.pay_type ? 1 : 0),
      price: raw.deprecated?.price ?? 0,
    },
  };
};

const normalizeMobileAlbumSong = (raw: MobileAlbumSong, fallbackCover?: string): KGSong => {
  const trans = raw.trans_param ?? {};
  const cover = fillCover(trans.union_cover || fallbackCover, 300);
  const coverOriginal = fillCover(trans.union_cover || fallbackCover, 480);
  const interval = raw.duration ?? 0;

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

  const filename = raw.filename || "";
  const artistName = raw.singername ? decodeName(raw.singername) : filename.split(" - ")[0] || "";
  const songName = raw.songname ? decodeName(raw.songname) : filename.split(" - ")[1] || filename;

  const artists = artistName ? artistName.split(" / ").map((name) => ({ id: name, name })) : [];

  return {
    id: String(raw.audio_id || raw.hash || ""),
    audioId: raw.audio_id ?? 0,
    albumAudioId: raw.album_audio_id,
    hash: raw.hash ?? "",
    name: decodeName(songName),
    artist: artistName,
    artists,
    album: decodeName(raw.album_name ?? ""),
    albumId: raw.album_id ?? "",
    cover,
    coverOriginal,
    interval,
    duration: interval * 1000,
    qualities: Object.keys(hashes) as Quality[],
    hashes,
    sizes,
    pay: {
      payplay: raw.pay_type ?? 0,
    },
  };
};

const resolveAlbumId = async (idOrName: string): Promise<string> => {
  if (/^[1-9]\d*$/.test(idOrName)) return idOrName;
  try {
    const searchRes = await kgGatewayRequest<{
      data?: {
        lists?: Array<{ albumid?: number | string }>;
        info?: Array<{ albumid?: number | string }>;
      };
    }>("/v1/search/album", {
      params: {
        keyword: idOrName,
        page: 1,
        pagesize: 1,
        platform: "AndroidFilter",
        iscorrection: 1,
        nocollect: 0,
      },
      headers: { "x-router": "complexsearch.kugou.com" },
    });
    const first = searchRes.data?.lists?.[0] || searchRes.data?.info?.[0];
    if (first?.albumid) return String(first.albumid);
  } catch {}
  return idOrName;
};

const loadAlbumFromMobile = async (albumId: string) => {
  const [infoRes, songsRes] = await Promise.all([
    kgRequest<{ data?: MobileAlbumInfo }>(
      `http://mobilecdn.kugou.com/api/v3/album/info?albumid=${encodeURIComponent(albumId)}&format=json`,
    ).catch(() => ({ data: undefined })),
    kgRequest<{ data?: { info?: MobileAlbumSong[]; total?: number } }>(
      `http://mobilecdn.kugou.com/api/v3/album/song?albumid=${encodeURIComponent(albumId)}&page=1&pagesize=300&format=json`,
    ).catch(() => ({ data: undefined })),
  ]);

  const info = infoRes.data ?? {};
  const rawSongs = songsRes.data?.info ?? [];
  const cover = fillCover(info.imgurl, 300);
  const coverOriginal = fillCover(info.imgurl, 480);
  const songs = rawSongs.map((s) => normalizeMobileAlbumSong(s, info.imgurl));

  return {
    code: 200,
    id: albumId,
    name: decodeName(info.albumname || ""),
    cover,
    coverOriginal,
    artist: decodeName(info.singername || ""),
    artists: info.singername
      ? [
          {
            id: info.singerid !== undefined ? String(info.singerid) : info.singername,
            name: decodeName(info.singername),
          },
        ]
      : [],
    publishTime: info.publishtime,
    description: info.intro,
    total: info.songcount ?? songsRes.data?.total ?? songs.length,
    songs,
  };
};

const album: KGModule = async (params) => {
  const rawId = String(params.id ?? params.album_id ?? "").trim();
  if (!rawId) return { code: 400, message: "id required" };

  const id = await resolveAlbumId(rawId);

  // 优先通过网关请求
  try {
    const [detailRes, songsRes] = await Promise.all([
      kgGatewayRequest<{ data?: RawAlbumDetail[] }>("/kmr/v2/albums", {
        method: "POST",
        data: {
          data: [{ album_id: id }],
          fields:
            "album_id,album_name,publish_date,sizable_cover,intro,language,authors,author_name,songcount",
        },
        headers: { "x-router": "openapi.kugou.com", "kg-tid": "255" },
      }),
      kgGatewayRequest<{
        data?: { songs?: RawAlbumSongEntry[]; total?: number } | RawAlbumSongEntry[];
      }>("/v1/album_audio/lite", {
        method: "POST",
        data: { album_id: id, page: 1, pagesize: 300 },
        headers: { "x-router": "openapi.kugou.com", "kg-tid": "255" },
      }),
    ]);

    const detail = detailRes.data?.[0] ?? {};
    const cover = fillCover(detail.sizable_cover, 300);
    const coverOriginal = fillCover(detail.sizable_cover, 480);

    const rawSongs: RawAlbumSongEntry[] = Array.isArray(songsRes.data)
      ? songsRes.data
      : (songsRes.data?.songs ?? []);
    const songs = rawSongs.map((item) => normalizeAlbumSong(item, detail.sizable_cover));

    const authors = detail.authors ?? [];
    const artistName =
      detail.author_name ||
      authors
        .map((a) => a.author_name)
        .filter(Boolean)
        .join(" / ") ||
      songs[0]?.artist ||
      "";

    return {
      code: 200,
      id,
      name: decodeName(detail.album_name || songs[0]?.album || rawId),
      cover,
      coverOriginal,
      artist: decodeName(artistName),
      artists: authors.map((a) => ({
        id: a.author_id !== undefined ? String(a.author_id) : undefined,
        name: decodeName(a.author_name || ""),
      })),
      publishTime: detail.publish_date,
      description: detail.intro,
      total: detail.songcount ?? songs.length,
      songs,
    };
  } catch {
    // 降级回退到 mobilecdn
    return await loadAlbumFromMobile(id);
  }
};

export default album;
