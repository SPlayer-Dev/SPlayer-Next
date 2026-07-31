/**
 * QM 四分类搜索
 *
 * 分类接口采用公开 CGI：其类型编码和返回结构长期稳定，避免移动端 musicu 搜索的
 * session / search_id 偶发校验错误。详情接口仍走 musicu.fcg。
 */

import { QM_HEADERS, formatSingerName } from "../core/config";
import type { QMModule } from "../core/types";

const SEARCH_URL = "https://c.y.qq.com/soso/fcgi-bin/client_search_cp";
const PLAYLIST_SEARCH_URL = "https://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist";
const secureUrl = (url: string | undefined): string => url?.replace(/^http:/, "https:") ?? "";

interface SearchBucket<T> {
  list?: T[];
  totalnum?: number;
}

interface QMSong {
  songid?: number;
  songmid?: string;
  songname?: string;
  interval?: number;
  singer?: Array<{ id?: number; mid?: string; name?: string }>;
  albumname?: string;
  albummid?: string;
  media_mid?: string;
  pay?: {
    payalbum?: number;
    payplay?: number;
  };
  size128?: number;
  size320?: number;
  sizeape?: number;
  sizeflac?: number;
  sizeogg?: number;
}

interface QMAlbum {
  albumID?: number;
  albumMID?: string;
  albumName?: string;
  albumPic?: string;
  singerName?: string;
  singerMID?: string;
  song_count?: number;
}

interface QMArtist {
  singerID?: number;
  singerMID?: string;
  singerName?: string;
  singerPic?: string;
  albumNum?: number;
  songNum?: number;
}

interface QMPlaylist {
  dissid?: string;
  dissname?: string;
  imgurl?: string;
  song_count?: number;
  listennum?: number;
  creator?: { name?: string };
}

const fetchJson = async <T>(url: URL): Promise<T> => {
  const res = await fetch(url, { headers: QM_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`QM 搜索请求失败: HTTP ${res.status}`);
  return (await res.json()) as T;
};

const searchCommon = async (keywords: string, page: number, limit: number, type: number) => {
  const url = new URL(SEARCH_URL);
  url.search = new URLSearchParams({
    format: "json",
    n: String(limit),
    p: String(page),
    w: keywords,
    cr: "1",
    g_tk: "5381",
    t: String(type),
  }).toString();
  return fetchJson<{ code?: number; message?: string; data?: Record<string, unknown> }>(url);
};

const searchSongs = async (keywords: string, page: number, limit: number) => {
  const body = await searchCommon(keywords, page, limit, 0);
  if (body.code !== 0) throw new Error(body.message || `QM 单曲搜索失败: ${body.code}`);
  const bucket = body.data?.song as SearchBucket<QMSong> | undefined;
  const songs = (bucket?.list ?? []).map((song) => ({
    id: String(song.songid ?? ""),
    mid: song.songmid ?? "",
    name: song.songname ?? "",
    artist: formatSingerName(song.singer),
    artists: song.singer ?? [],
    album: song.albumname ?? "",
    albumMid: song.albummid ?? "",
    duration: (song.interval ?? 0) * 1000,
    mediaMid: song.media_mid ?? "",
    pay: song.pay,
    size128: song.size128 ?? 0,
    size320: song.size320 ?? 0,
    sizeApe: song.sizeape ?? 0,
    sizeFlac: song.sizeflac ?? 0,
    sizeOgg: song.sizeogg ?? 0,
  }));
  return { code: 200, total: bucket?.totalnum ?? songs.length, songs };
};

const searchAlbums = async (keywords: string, page: number, limit: number) => {
  const body = await searchCommon(keywords, page, limit, 8);
  if (body.code !== 0) throw new Error(body.message || `QM 专辑搜索失败: ${body.code}`);
  const bucket = body.data?.album as SearchBucket<QMAlbum> | undefined;
  const albums = (bucket?.list ?? []).map((album) => ({
    id: album.albumMID ?? String(album.albumID ?? ""),
    name: album.albumName ?? "",
    cover: secureUrl(album.albumPic),
    artist: album.singerName ?? "",
    artistMid: album.singerMID ?? "",
    trackCount: album.song_count ?? 0,
  }));
  return { code: 200, total: bucket?.totalnum ?? albums.length, albums };
};

const searchArtists = async (keywords: string, page: number, limit: number) => {
  const body = await searchCommon(keywords, page, limit, 9);
  if (body.code !== 0) throw new Error(body.message || `QM 歌手搜索失败: ${body.code}`);
  const bucket = body.data?.singer as SearchBucket<QMArtist> | undefined;
  const artists = (bucket?.list ?? []).map((artist) => ({
    id: artist.singerMID ?? String(artist.singerID ?? ""),
    name: artist.singerName ?? "",
    cover: secureUrl(artist.singerPic),
    albumCount: artist.albumNum ?? 0,
    songCount: artist.songNum ?? 0,
  }));
  return { code: 200, total: bucket?.totalnum ?? artists.length, artists };
};

const searchPlaylists = async (keywords: string, page: number, limit: number) => {
  const url = new URL(PLAYLIST_SEARCH_URL);
  url.search = new URLSearchParams({
    remoteplace: "txt.yqq.playlist",
    page_no: String(page - 1),
    num_per_page: String(limit),
    query: keywords,
    format: "json",
  }).toString();
  const body = await fetchJson<{
    code?: number;
    data?: { list?: QMPlaylist[]; display_num?: number };
  }>(url);
  if (body.code !== 0) throw new Error(`QM 歌单搜索失败: ${body.code}`);
  const playlists = (body.data?.list ?? []).map((playlist) => ({
    id: playlist.dissid ?? "",
    name: playlist.dissname ?? "",
    cover: secureUrl(playlist.imgurl),
    creator: playlist.creator?.name ?? "",
    trackCount: playlist.song_count ?? 0,
    playCount: playlist.listennum ?? 0,
  }));
  return { code: 200, total: body.data?.display_num ?? playlists.length, playlists };
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
