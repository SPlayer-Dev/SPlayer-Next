import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { qqmusic as qmApi } from "@/apis/qqmusic";
import type { SearchResult } from "./index";

/** 主进程返回的单曲行 */
interface QMSong {
  id: string;
  mid?: string;
  name: string;
  artist: string;
  album?: string;
  albumMid?: string;
  duration: number;
}

interface SongsResp {
  total?: number;
  songs?: QMSong[];
}

/** QM 封面 URL：size 为像素，T002 限到 800 以内 */
const albumCoverByMid = (mid: string, size = 300): string =>
  `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${mid}.jpg`;

const songToTrack = (song: QMSong): Track => {
  const cover = song.albumMid ? albumCoverByMid(song.albumMid) : undefined;
  const coverOriginal = song.albumMid ? albumCoverByMid(song.albumMid, 800) : undefined;
  // id 优先 mid
  return {
    id: song.mid || song.id,
    extId: song.mid && song.id !== song.mid ? song.id : undefined,
    source: "qqmusic",
    title: song.name,
    // QM 的 song.artist 是合并字符串（"A / B"），没单独 id，列表里会自动暗显
    artists: song.artist ? [{ name: song.artist }] : [],
    // 在线专辑详情页还没接通（Artist.vue 的 TODO: online），暂不把 albumMid 当 id 暴露，
    // 列表里会跟 artist 一起暗显；mid 只留给封面 URL
    album: song.album ? { name: song.album, cover } : undefined,
    duration: song.duration ?? 0,
    cover,
    coverOriginal,
  };
};

const empty = <T>(): SearchResult<T> => ({ items: [], total: 0, hasMore: false });

export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await qmApi.search<SongsResp>({
    keywords: keyword,
    type: 0,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body?.songs ?? []).map(songToTrack);
  const total = body?.total ?? items.length;
  return { items, total, hasMore: offset + items.length < total };
};

// 在线专辑/歌手/歌单详情页未接通
export const albums = async (
  _keyword: string,
  _offset: number,
  _limit: number,
): Promise<SearchResult<CoverItem>> => empty();
export const artists = async (
  _keyword: string,
  _offset: number,
  _limit: number,
): Promise<SearchResult<CoverItem>> => empty();
export const playlists = async (
  _keyword: string,
  _offset: number,
  _limit: number,
): Promise<SearchResult<CoverItem>> => empty();
