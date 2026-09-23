/**
 * KG 歌手详情、热门歌曲与专辑
 *
 * 接口：
 * - 歌手详情：POST /kmr/v3/author (openapi.kugou.com)
 * - 歌手单曲：POST /kmr/v1/audio_group/author (openapi.kugou.com)
 * - 歌手专辑：POST /kmr/v1/author/albums (openapi.kugou.com)
 */

import { decodeName, fillCover } from "../core/config";
import { signParamsKey } from "../core/crypto";
import { kgGatewayRequest } from "../core/request";
import type { KGAlbumItem, KGArtistItem, KGModule, KGSong, Quality } from "../core/types";

interface RawArtistDetail {
  author_id?: number | string;
  author_name?: string;
  sizable_avatar?: string;
  album_count?: number;
  mv_count?: number;
  fansnums?: number;
  intro?: string;
  birthday?: string;
  long_intro?: Array<{ content?: string }>;
}

interface RawArtistAudio {
  audio_id?: number;
  album_audio_id?: number;
  audio_name?: string;
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
  timelength?: number;
  timelength_128?: number;
  timelength_320?: number;
  timelength_flac?: number;
  timelength_high?: number;
  duration?: number;
  duration_128?: number;
  duration_320?: number;
  duration_flac?: number;
  duration_high?: number;
  album_id?: number | string;
  album_name?: string;
  author_name?: string;
  authors?: Array<{ author_id?: number | string; author_name?: string }>;
  trans_param?: {
    union_cover?: string;
    pay_block_tpl?: number;
  };
  pay_type?: number;
}

interface RawArtistAlbum {
  album_id?: number | string;
  album_name?: string;
  sizable_cover?: string;
  author_name?: string;
  publish_date?: string;
  song_count?: number;
  grade_count?: number;
}

const normalizeArtistSong = (
  raw: RawArtistAudio,
  currentArtistId: string,
  defaultCover?: string,
): KGSong => {
  const trans = raw.trans_param ?? {};
  const cover = fillCover(trans.union_cover || defaultCover, 300);
  const coverOriginal = fillCover(trans.union_cover || defaultCover, 480);

  const duration =
    raw.timelength_320 ||
    raw.timelength_flac ||
    raw.timelength_128 ||
    raw.timelength_high ||
    raw.timelength ||
    raw.duration_320 ||
    raw.duration_128 ||
    raw.duration_flac ||
    raw.duration ||
    0;

  const sizes: Partial<Record<Quality, number>> = {};
  const hashes: Partial<Record<Quality, string>> = {};

  const f128 = raw.filesize_128 ?? raw.filesize;
  const h128 = raw.hash_128 ?? raw.hash;
  if (f128 && h128) {
    sizes["128k"] = f128;
    hashes["128k"] = h128;
  }
  if (raw.filesize_320 && raw.hash_320) {
    sizes["320k"] = raw.filesize_320;
    hashes["320k"] = raw.hash_320;
  }
  if (raw.filesize_flac && raw.hash_flac) {
    sizes.flac = raw.filesize_flac;
    hashes.flac = raw.hash_flac;
  }
  if (raw.filesize_high && raw.hash_high) {
    sizes.flac24bit = raw.filesize_high;
    hashes.flac24bit = raw.hash_high;
  }

  const authors = raw.authors ?? [];
  const artistStr =
    authors
      .map((a) => a.author_name)
      .filter(Boolean)
      .join(" / ") ||
    raw.author_name ||
    "";

  const artists = authors.length
    ? authors.map((a) => ({
        id: a.author_id !== undefined ? String(a.author_id) : currentArtistId,
        name: decodeName(a.author_name || ""),
      }))
    : [{ id: currentArtistId, name: decodeName(artistStr) }];

  return {
    id: String(raw.audio_id || raw.hash || ""),
    audioId: raw.audio_id ?? 0,
    albumAudioId: raw.album_audio_id,
    hash: raw.hash_128 || raw.hash || "",
    name: decodeName(raw.audio_name || ""),
    artist: decodeName(artistStr),
    artistId: currentArtistId,
    artists,
    album: decodeName(raw.album_name ?? ""),
    albumId: raw.album_id ?? "",
    cover,
    coverOriginal,
    interval: Math.round(duration / 1000),
    duration,
    qualities: Object.keys(hashes) as Quality[],
    hashes,
    sizes,
    pay: {
      payplay: raw.pay_type ?? 0,
    },
  };
};

const resolveAuthorId = async (idOrName: string): Promise<string> => {
  if (/^\d+$/.test(idOrName)) return idOrName;
  try {
    const searchRes = await kgGatewayRequest<{
      data?: { lists?: Array<{ AuthorId?: number | string }> };
    }>("/v1/search/author", {
      params: {
        keyword: idOrName,
        page: 1,
        pagesize: 1,
        platform: "AndroidFilter",
        iscorrection: 1,
      },
      headers: { "x-router": "complexsearch.kugou.com" },
    });
    const first = searchRes.data?.lists?.[0];
    if (first?.AuthorId) return String(first.AuthorId);
  } catch {}
  return idOrName;
};

const artist: KGModule = async (params) => {
  const rawId = String(params.id ?? params.author_id ?? params.artist_id ?? "").trim();
  if (!rawId) return { code: 400, message: "id required" };

  const id = await resolveAuthorId(rawId);
  const clienttime = Math.floor(Date.now() / 1000);

  const [detailRes, songsRes, albumsRes] = await Promise.all([
    kgGatewayRequest<{ data?: RawArtistDetail }>("/kmr/v3/author", {
      method: "POST",
      data: { author_id: id },
      headers: { "x-router": "openapi.kugou.com", "kg-tid": "36" },
    }),
    kgGatewayRequest<{ data?: RawArtistAudio[]; total?: number }>("/kmr/v1/audio_group/author", {
      method: "POST",
      baseURL: "https://openapi.kugou.com",
      data: {
        author_id: id,
        pagesize: 50,
        page: 1,
        sort: 1,
        area_code: "all",
        clienttime,
        key: signParamsKey(clienttime),
      },
      headers: { "x-router": "openapi.kugou.com", "kg-tid": "220" },
    }),
    kgGatewayRequest<{ data?: RawArtistAlbum[]; total?: number }>("/kmr/v1/author/albums", {
      method: "POST",
      data: {
        author_id: id,
        pagesize: 50,
        page: 1,
        sort: 3,
        category: 1,
        area_code: "all",
      },
      headers: { "x-router": "openapi.kugou.com", "kg-tid": "36" },
    }),
  ]);

  const detail = detailRes.data ?? {};
  const rawSongs = songsRes.data ?? [];
  const rawAlbums = albumsRes.data ?? [];

  const avatar = fillCover(detail.sizable_avatar, 300);
  const songs = rawSongs.map((s) => normalizeArtistSong(s, id));
  const albums: KGAlbumItem[] = rawAlbums.map((a) => ({
    id: String(a.album_id ?? ""),
    name: decodeName(a.album_name || ""),
    cover: fillCover(a.sizable_cover, 300),
    artist: decodeName(a.author_name || detail.author_name || ""),
    artistId: id,
    trackCount: a.song_count ?? 0,
    publishTime: a.publish_date,
  }));

  const introText =
    detail.intro ||
    (detail.long_intro &&
      detail.long_intro
        .map((item) => item.content)
        .filter(Boolean)
        .join("\n\n"));

  const artistInfo: KGArtistItem & { intro?: string; avatar?: string } = {
    id: String(detail.author_id || id),
    name: decodeName(detail.author_name || rawId),
    cover: avatar,
    avatar,
    songCount: songsRes.total ?? songs.length,
    albumCount: detail.album_count ?? albumsRes.total ?? albums.length,
    fansCount: detail.fansnums,
    intro: introText,
  };

  return {
    code: 200,
    artist: artistInfo,
    songs,
    albums,
  };
};

export default artist;
