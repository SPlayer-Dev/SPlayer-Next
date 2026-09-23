/**
 * KG 多分类搜索模块
 *
 * 支持分类：
 * - 0 / "song": 单曲（主走 mobilecdn，含封面与音质分级；失败兜底 songsearch）
 * - 8 / "album": 专辑（走 gateway 的 /v1/search/album，带 Android 签名与 complexsearch 路由）
 * - 9 / "artist" / "author": 歌手（走 gateway 的 /v1/search/author）
 * - 2 / "playlist" / "special": 歌单（走 gateway 的 /v1/search/special）
 */

import {
  KG_MOBILECDN_URL,
  KG_SEARCH_URL,
  decodeName,
  fillCover,
  formatSingerName,
} from "../core/config";
import { kgGatewayRequest, kgRequest } from "../core/request";
import type {
  KGAlbumItem,
  KGArtistItem,
  KGModule,
  KGPlaylistItem,
  KGSong,
  Quality,
} from "../core/types";

interface MobileSong {
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
  pay_type_320?: number;
  pay_type_sq?: number;
  privilege?: number;
  feetype?: number;
  pkg_price?: number;
  price?: number;
  group?: MobileSong[];
  trans_param?: {
    union_cover?: string;
    pay_block_tpl?: number;
  };
}

interface MobileResp {
  status?: number;
  error_code?: number;
  data?: {
    total?: number;
    info?: MobileSong[];
  };
}

interface LegacySong {
  Audioid: number;
  MixSongID?: number;
  AlbumAudioId?: number;
  SongName: string;
  Singers?: Array<{ id?: number | string; name?: string }>;
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
  PayType?: number;
  Privilege?: number;
  PkgPrice?: number;
  Price?: number;
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

interface RawKGAlbum {
  albumid?: number | string;
  albumname?: string;
  singer?: string;
  singers?: Array<{ id?: number; name?: string }>;
  singerid?: number | string;
  singerids?: Array<number | string>;
  img?: string;
  songcount?: number;
  publish_time?: string;
  intro?: string;
}

interface RawKGAuthor {
  AuthorId?: number | string;
  AuthorName?: string;
  Avatar?: string;
  FirstFrameImage?: string;
  AlbumCount?: number;
  AudioCount?: number;
  FansNum?: number;
}

interface RawKGSpecial {
  specialid?: number | string;
  gid?: string;
  specialname?: string;
  img?: string;
  nickname?: string;
  song_count?: number;
  play_count?: number | string;
  total_play_count?: number | string;
}

interface SearchResponseData<T> {
  total?: number;
  lists?: T[];
  info?: T[];
}

const formatMobileArtist = (name: string | undefined): string => {
  if (!name) return "";
  return decodeName(name)
    .split(/、|,|;|\//)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" / ");
};

const normalizeFromMobile = (raw: MobileSong): KGSong => {
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
  const artistName = formatMobileArtist(raw.singername);
  const artists = artistName ? artistName.split(" / ").map((name) => ({ id: name, name })) : [];

  return {
    id: String(raw.audio_id || raw.hash || ""),
    audioId: raw.audio_id ?? 0,
    albumAudioId: raw.album_audio_id,
    hash: raw.hash ?? "",
    name: decodeName(raw.songname || raw.filename || ""),
    artist: artistName,
    artists,
    album: decodeName(raw.album_name ?? ""),
    albumId: raw.album_id ?? "",
    cover: fillCover(coverTpl, 300),
    coverOriginal: fillCover(coverTpl, 480),
    interval,
    duration: interval * 1000,
    qualities: Object.keys(hashes) as Quality[],
    hashes,
    sizes,
    pay: {
      payplay: raw.pay_type ?? 0,
      privilege: raw.privilege ?? 0,
      feetype: raw.feetype ?? 0,
      pkg_price: raw.pkg_price ?? 0,
      price: raw.price ?? 0,
    },
  };
};

const normalizeFromLegacy = (raw: LegacySong): KGSong => {
  const sizes: Partial<Record<Quality, number>> = {};
  const hashes: Partial<Record<Quality, string>> = {};

  if (raw.FileSize && raw.FileHash) {
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

  const singers = raw.Singers ?? [];
  const artistName = formatSingerName(singers);
  const artists = singers.length
    ? singers.map((s) => ({
        id: s.id !== undefined ? String(s.id) : s.name || undefined,
        name: decodeName(s.name || ""),
      }))
    : artistName
      ? [{ id: artistName, name: artistName }]
      : [];

  return {
    id: String(raw.Audioid || raw.FileHash || ""),
    audioId: raw.Audioid,
    albumAudioId: raw.MixSongID ?? raw.AlbumAudioId,
    hash: raw.FileHash,
    name: decodeName(raw.SongName),
    artist: artistName,
    artists,
    album: decodeName(raw.AlbumName ?? ""),
    albumId: raw.AlbumID ?? "",
    cover: undefined,
    interval: raw.Duration,
    duration: raw.Duration * 1000,
    qualities: Object.keys(hashes) as Quality[],
    hashes,
    sizes,
    pay: {
      payplay: raw.PayType ?? 0,
      privilege: raw.Privilege ?? 0,
      pkg_price: raw.PkgPrice ?? 0,
      price: raw.Price ?? 0,
    },
  };
};

const searchSongsMobile = async (keywords: string, page: number, limit: number) => {
  const url =
    `${KG_MOBILECDN_URL}?keyword=${encodeURIComponent(keywords)}` +
    `&page=${page}&pagesize=${limit}&format=json&showtype=1`;

  const body = await kgRequest<MobileResp>(url);
  const raw = body.data?.info ?? [];

  const songs: KGSong[] = [];
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

const searchSongsLegacy = async (keywords: string, page: number, limit: number) => {
  const url =
    `${KG_SEARCH_URL}?keyword=${encodeURIComponent(keywords)}` +
    `&page=${page}&pagesize=${limit}` +
    `&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`;

  const body = await kgRequest<LegacyResp>(url);
  const raw = body.data?.lists ?? [];
  const songs: KGSong[] = [];
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

const searchSongs = async (keywords: string, page: number, limit: number) => {
  try {
    const result = await searchSongsMobile(keywords, page, limit);
    if (result.songs.length > 0) return result;
  } catch {}
  return searchSongsLegacy(keywords, page, limit);
};

const searchAlbums = async (keywords: string, page: number, limit: number) => {
  const res = await kgGatewayRequest<{ data?: SearchResponseData<RawKGAlbum> }>(
    "/v1/search/album",
    {
      params: {
        keyword: keywords,
        page,
        pagesize: limit,
        platform: "AndroidFilter",
        iscorrection: 1,
        albumhide: 0,
        nocollect: 0,
      },
      headers: {
        "x-router": "complexsearch.kugou.com",
      },
    },
  );

  const rawList = res.data?.lists ?? res.data?.info ?? [];
  const albums: KGAlbumItem[] = rawList.map((raw) => {
    const singerStr =
      raw.singer ||
      (raw.singers
        ? raw.singers
            .map((s) => s.name)
            .filter(Boolean)
            .join(" / ")
        : "");
    const artistId = raw.singerid || raw.singerids?.[0];
    return {
      id: String(raw.albumid ?? ""),
      name: decodeName(raw.albumname),
      cover: fillCover(raw.img, 300),
      artist: decodeName(singerStr),
      artistId: artistId !== undefined ? String(artistId) : undefined,
      trackCount: raw.songcount ?? 0,
      publishTime: raw.publish_time,
      intro: raw.intro,
    };
  });

  return {
    code: 200,
    total: res.data?.total ?? albums.length,
    albums,
  };
};

const searchArtists = async (keywords: string, page: number, limit: number) => {
  const res = await kgGatewayRequest<{ data?: SearchResponseData<RawKGAuthor> }>(
    "/v1/search/author",
    {
      params: {
        keyword: keywords,
        page,
        pagesize: limit,
        platform: "AndroidFilter",
        iscorrection: 1,
      },
      headers: {
        "x-router": "complexsearch.kugou.com",
      },
    },
  );

  const rawList = res.data?.lists ?? res.data?.info ?? [];
  const artists: KGArtistItem[] = rawList.map((raw) => ({
    id: String(raw.AuthorId ?? ""),
    name: decodeName(raw.AuthorName),
    cover: fillCover(raw.Avatar || raw.FirstFrameImage, 300),
    albumCount: raw.AlbumCount ?? 0,
    songCount: raw.AudioCount ?? 0,
    fansCount: raw.FansNum ?? 0,
  }));

  return {
    code: 200,
    total: res.data?.total ?? artists.length,
    artists,
  };
};

const searchPlaylists = async (keywords: string, page: number, limit: number) => {
  const res = await kgGatewayRequest<{ data?: SearchResponseData<RawKGSpecial> }>(
    "/v1/search/special",
    {
      params: {
        keyword: keywords,
        page,
        pagesize: limit,
        platform: "AndroidFilter",
        iscorrection: 1,
      },
      headers: {
        "x-router": "complexsearch.kugou.com",
      },
    },
  );

  const rawList = res.data?.lists ?? res.data?.info ?? [];
  const playlists: KGPlaylistItem[] = rawList.map((raw) => ({
    id: String(raw.specialid || raw.gid || ""),
    name: decodeName(raw.specialname),
    cover: fillCover(raw.img, 300),
    creator: decodeName(raw.nickname),
    trackCount: raw.song_count ?? 0,
    playCount: Number(raw.play_count || raw.total_play_count || 0),
  }));

  return {
    code: 200,
    total: res.data?.total ?? playlists.length,
    playlists,
  };
};

const search: KGModule = async (params) => {
  const {
    keywords,
    page = 1,
    limit = 30,
    type = 0,
  } = params as {
    keywords?: string;
    page?: number;
    limit?: number;
    type?: number | string;
  };

  if (!keywords) {
    return { code: 400, total: 0, message: "keywords required" };
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Number(limit) || 30);

  if (type === 0 || type === "song") {
    return searchSongs(keywords, pageNum, limitNum);
  }
  if (type === 8 || type === "album") {
    return searchAlbums(keywords, pageNum, limitNum);
  }
  if (type === 9 || type === "artist" || type === "author") {
    return searchArtists(keywords, pageNum, limitNum);
  }
  if (type === 2 || type === "playlist" || type === "special") {
    return searchPlaylists(keywords, pageNum, limitNum);
  }

  return { code: 400, total: 0, message: `unsupported kg search type: ${type}` };
};

export default search;
