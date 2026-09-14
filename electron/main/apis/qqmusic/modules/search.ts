/**
 * QM 四分类搜索
 */

import { formatSingerName } from "../core/config";
import { qmRequest } from "../core/request";
import type { QMModule } from "../core/types";

const secureUrl = (url: string | undefined): string => url?.replace(/^http:/, "https:") ?? "";
const stripHighlight = (text: string | undefined): string => text?.replace(/<\/?em>/g, "") ?? "";

interface MobileSong {
  id?: number;
  mid?: string;
  title?: string;
  interval?: number;
  singer?: Array<{ id?: number; mid?: string; name?: string }>;
  album?: { mid?: string; name?: string; title?: string; pmid?: string };
  file?: {
    media_mid?: string;
    size_128mp3?: number;
    size_320mp3?: number;
    size_ape?: number;
    size_flac?: number;
    size_192ogg?: number;
    size_hires?: number;
    size_new?: number[];
    hires_sample?: number;
    hires_bitdepth?: number;
  };
  pay?: {
    pay_month?: number;
    pay_play?: number;
    price_album?: number;
  };
}

interface MobileSearchResponse {
  body?: {
    item_song?: MobileSong[];
    item_album?: MobileAlbum[];
    singer?: MobileArtist[];
    item_songlist?: MobilePlaylist[];
  };
  meta?: { sum?: number };
}

interface MobileAlbum {
  id?: number;
  albummid?: string;
  name?: string;
  pic?: string;
  singer?: string;
  singer_list?: Array<{ mid?: string; name?: string }>;
  song_num?: number;
}

interface MobileArtist {
  singerID?: number;
  singerMID?: string;
  singerName?: string;
  singerPic?: string;
  iconurl?: string;
  albumNum?: number;
  songNum?: number;
}

interface MobilePlaylist {
  dissid?: string;
  dissname?: string;
  logo?: string;
  layer_url?: string;
  songnum?: number;
  listennum?: number;
  nickname?: string;
}

/** 生成移动端搜索请求所需的会话 ID */
const createSearchId = (): string => {
  const group = BigInt(Math.floor(Math.random() * 20) + 1);
  const random = BigInt(Math.floor(Math.random() * 4194305));
  const todayMs = BigInt(Date.now() % 86400000);
  return String(group * 18014398509481984n + random * 4294967296n + todayMs);
};

const searchMobile = (keywords: string, page: number, limit: number, searchType: number) =>
  qmRequest<MobileSearchResponse>(
    "music.search.SearchCgiService",
    "DoSearchForQQMusicLite",
    {
      search_id: createSearchId(),
      remoteplace: "search.android.keyboard",
      query: keywords,
      page_num: page,
      num_per_page: limit,
      search_type: searchType,
      highlight: 0,
      nqc_flag: 0,
      page_id: 1,
      grp: 1,
    },
    {
      session: false,
      auth: false,
      comm: {
        tmeAppID: "qqmusiclight",
        cv: "1003006",
        v: "1003006",
      },
    },
  );

const searchSongs = async (keywords: string, page: number, limit: number) => {
  const data = await searchMobile(keywords, page, limit, 0);
  const songs = (data.body?.item_song ?? []).map((song) => {
    const albumMid = song.album?.mid ?? "";
    const albumPmid = song.album?.pmid ?? "";
    const pictureMid = albumMid || albumPmid;
    return {
      id: String(song.id ?? ""),
      mid: song.mid ?? "",
      name: song.title ?? "",
      artist: formatSingerName(song.singer),
      artists: song.singer ?? [],
      album: song.album?.name || song.album?.title || "",
      albumMid,
      duration: (song.interval ?? 0) * 1000,
      mediaMid: song.file?.media_mid ?? "",
      pay: {
        payalbum: song.pay?.pay_month === 0 && (song.pay.price_album ?? 0) > 0 ? 1 : 0,
        payplay: song.pay?.pay_play ?? 0,
      },
      size128: song.file?.size_128mp3 ?? 0,
      size320: song.file?.size_320mp3 ?? 0,
      sizeApe: song.file?.size_ape ?? 0,
      sizeFlac: song.file?.size_flac ?? 0,
      sizeOgg: song.file?.size_192ogg ?? 0,
      sizeHiRes: song.file?.size_hires || song.file?.size_new?.[0] || 0,
      hiResSampleRate: song.file?.hires_sample ?? 0,
      hiResBitDepth: song.file?.hires_bitdepth ?? 0,
      cover: pictureMid
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${pictureMid}.jpg`
        : "",
      coverOriginal: pictureMid
        ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${pictureMid}.jpg`
        : "",
    };
  });
  return { code: 200, total: data.meta?.sum ?? songs.length, songs };
};

const searchAlbums = async (keywords: string, page: number, limit: number) => {
  const data = await searchMobile(keywords, page, limit, 2);
  const albums = (data.body?.item_album ?? []).map((album) => ({
    id: album.albummid ?? String(album.id ?? ""),
    name: album.name ?? "",
    cover: secureUrl(album.pic),
    artist: album.singer || formatSingerName(album.singer_list),
    artistMid: album.singer_list?.[0]?.mid ?? "",
    trackCount: album.song_num ?? 0,
  }));
  return { code: 200, total: data.meta?.sum ?? albums.length, albums };
};

const searchArtists = async (keywords: string, page: number, limit: number) => {
  const data = await searchMobile(keywords, page, limit, 1);
  const artists = (data.body?.singer ?? []).map((artist) => ({
    id: artist.singerMID ?? String(artist.singerID ?? ""),
    name: artist.singerName ?? "",
    cover: secureUrl(artist.singerPic || artist.iconurl),
    albumCount: artist.albumNum ?? 0,
    songCount: artist.songNum ?? 0,
  }));
  return { code: 200, total: data.meta?.sum ?? artists.length, artists };
};

const searchPlaylists = async (keywords: string, page: number, limit: number) => {
  const data = await searchMobile(keywords, page, limit, 3);
  const playlists = (data.body?.item_songlist ?? []).map((playlist) => ({
    id: playlist.dissid ?? "",
    name: stripHighlight(playlist.dissname),
    cover: secureUrl(playlist.logo || playlist.layer_url),
    creator: playlist.nickname ?? "",
    trackCount: playlist.songnum ?? 0,
    playCount: playlist.listennum ?? 0,
  }));
  return { code: 200, total: data.meta?.sum ?? playlists.length, playlists };
};

const search: QMModule = async (params) => {
  const {
    keywords,
    page = 1,
    limit = 30,
    type = 0,
  } = params as {
    keywords?: string;
    page?: number;
    limit?: number;
    type?: number;
  };
  if (!keywords) return { code: 400, total: 0, message: "keywords required" };
  if (type === 0) return searchSongs(keywords, page, limit);
  if (type === 8) return searchAlbums(keywords, page, limit);
  if (type === 9) return searchArtists(keywords, page, limit);
  if (type === 2) return searchPlaylists(keywords, page, limit);
  return { code: 400, total: 0, message: `unsupported search type: ${type}` };
};

export default search;
