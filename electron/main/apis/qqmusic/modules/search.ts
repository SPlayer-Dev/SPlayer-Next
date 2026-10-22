/**
 * QM 四分类搜索
 */

import { formatSingerName } from "../core/config";
import { qmRequest } from "../core/request";
import { normalizeQMSong, type QMAudioInfo } from "../core/song";
import type { QMAlbumItem, QMArtistItem, QMPlaylistItem } from "@shared/types/platform/qqmusic";
import type { QMModule } from "../core/types";

const secureUrl = (url: string | undefined): string => url?.replace(/^http:/, "https:") ?? "";
const stripHighlight = (text: string | undefined): string => text?.replace(/<\/?em>/g, "") ?? "";

interface MobileSearchResponse {
  body?: {
    item_song?: QMAudioInfo[];
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
      signed: true,
      comm: {
        tmeAppID: "qqmusiclight",
        cv: "1003006",
        v: "1003006",
      },
    },
  );

/**
 * 搜索单曲并复用歌曲字段归一化
 * @param keywords - 搜索关键词
 * @param page - 从 1 开始的页码
 * @param limit - 每页数量
 * @returns 歌曲列表与总数
 */
const searchSongs = async (keywords: string, page: number, limit: number) => {
  const data = await searchMobile(keywords, page, limit, 0);
  const songs = (data.body?.item_song ?? []).map((song) => normalizeQMSong(song));
  return { code: 200, total: data.meta?.sum ?? songs.length, songs };
};

/**
 * 搜索专辑并转换为共享专辑结构
 * @param keywords - 搜索关键词
 * @param page - 从 1 开始的页码
 * @param limit - 每页数量
 * @returns 专辑列表与总数
 */
const searchAlbums = async (keywords: string, page: number, limit: number) => {
  const data = await searchMobile(keywords, page, limit, 2);
  const albums: QMAlbumItem[] = (data.body?.item_album ?? []).map((album) => ({
    id: album.albummid ?? String(album.id ?? ""),
    name: album.name ?? "",
    cover: secureUrl(album.pic),
    artist: album.singer || formatSingerName(album.singer_list),
    artistMid: album.singer_list?.[0]?.mid ?? "",
    trackCount: album.song_num ?? 0,
  }));
  return { code: 200, total: data.meta?.sum ?? albums.length, albums };
};

/**
 * 搜索歌手并转换为共享歌手结构
 * @param keywords - 搜索关键词
 * @param page - 从 1 开始的页码
 * @param limit - 每页数量
 * @returns 歌手列表与总数
 */
const searchArtists = async (keywords: string, page: number, limit: number) => {
  const data = await searchMobile(keywords, page, limit, 1);
  const artists: QMArtistItem[] = (data.body?.singer ?? []).map((artist) => ({
    id: artist.singerMID ?? String(artist.singerID ?? ""),
    name: artist.singerName ?? "",
    cover: secureUrl(artist.singerPic || artist.iconurl),
    albumCount: artist.albumNum ?? 0,
    songCount: artist.songNum ?? 0,
  }));
  return { code: 200, total: data.meta?.sum ?? artists.length, artists };
};

/**
 * 搜索歌单并转换为共享歌单结构
 * @param keywords - 搜索关键词
 * @param page - 从 1 开始的页码
 * @param limit - 每页数量
 * @returns 歌单列表与总数
 */
const searchPlaylists = async (keywords: string, page: number, limit: number) => {
  const data = await searchMobile(keywords, page, limit, 3);
  const playlists: QMPlaylistItem[] = (data.body?.item_songlist ?? []).map((playlist) => ({
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
