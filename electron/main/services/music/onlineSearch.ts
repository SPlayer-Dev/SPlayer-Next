import { callKugou } from "@main/apis/kugou";
import { callNetease } from "@main/apis/netease";
import { callQQMusic } from "@main/apis/qqmusic";
import type { Track } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import type { NeteaseSong } from "@shared/types/platform/netease";
import type { QMSong } from "@shared/types/platform/qqmusic";
import type { KGSong } from "@shared/types/platform/kugou";
import type { OnlineSearchResult } from "@shared/types/music";

const sizedNeteaseCover = (url: string | undefined, size: number): string | undefined =>
  url ? `${url}${url.includes("?param=") ? "" : `?param=${size}y${size}`}` : undefined;

/**
 * 将 NCM 搜索歌曲转换为共用的轻量歌曲
 * @param song - NCM 歌曲
 * @returns 统一歌曲信息
 */
const neteaseToTrack = (song: NeteaseSong): Track => {
  const album = song.al ?? song.album;
  const artists = song.ar ?? song.artists ?? [];
  const cover = sizedNeteaseCover(album?.picUrl, 300);
  return {
    id: String(song.id),
    source: "netease",
    title: song.name,
    comment: (song.alia ?? song.alias)?.find((item) => item.trim()) || undefined,
    artists: artists.map((artist) => ({
      id: artist.id == null ? undefined : String(artist.id),
      name: artist.name ?? "",
    })),
    album: album?.name
      ? { id: album.id == null ? undefined : String(album.id), name: album.name, cover }
      : undefined,
    duration: song.dt ?? song.duration ?? 0,
    cover,
    coverOriginal: sizedNeteaseCover(album?.picUrl, 1024),
    fee: song.fee,
  };
};

const qqCover = (mid: string, size: number): string =>
  `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${mid}.jpg`;

/**
 * 将 QM 搜索歌曲转换为共用的轻量歌曲
 * @param song - QM 歌曲
 * @returns 统一歌曲信息
 */
const qqMusicToTrack = (song: QMSong): Track => {
  const cover = song.albumMid ? qqCover(song.albumMid, 300) : undefined;
  return {
    id: song.mid || song.id,
    extId: song.mid && song.id !== song.mid ? song.id : undefined,
    source: "qqmusic",
    title: song.name,
    artists: song.artist ? [{ name: song.artist }] : [],
    album: song.album ? { name: song.album, cover } : undefined,
    duration: song.duration ?? 0,
    cover,
    coverOriginal: song.albumMid ? qqCover(song.albumMid, 800) : undefined,
  };
};

/**
 * 将 KG 搜索歌曲转换为共用的轻量歌曲
 * @param song - KG 歌曲
 * @returns 统一歌曲信息
 */
const kugouToTrack = (song: KGSong): Track => ({
  id: song.hash || song.id,
  source: "kugou",
  title: song.name,
  artists: song.artist ? [{ name: song.artist }] : [],
  album: song.album ? { name: song.album, cover: song.cover } : undefined,
  duration: song.duration ?? 0,
  cover: song.cover,
  coverOriginal: song.coverOriginal,
});

/**
 * 包装在线搜索的统一分页结果
 * @param platform - 搜索平台
 * @param page - 从 1 开始的页码
 * @param limit - 每页曲目数
 * @param total - 匹配曲目总数
 * @param tracks - 当前页的轻量曲目
 * @returns 可供插件与 MCP 共用的搜索结果
 */
const result = (
  platform: Platform,
  page: number,
  limit: number,
  total: number,
  tracks: Track[],
): OnlineSearchResult => {
  return {
    platform,
    page,
    total,
    hasMore: (page - 1) * limit + tracks.length < total,
    tracks,
  };
};

/**
 * 搜索在线平台单曲并转换为可直接播放的 Track
 * @param platform - 在线音乐平台
 * @param query - 搜索关键词
 * @param page - 从 1 开始的页码
 * @param limit - 每页数量
 * @returns 统一搜索结果
 */
export const searchOnlineTracks = async (
  platform: Platform,
  query: string,
  page: number,
  limit: number,
): Promise<OnlineSearchResult> => {
  if (platform === "netease") {
    const { body } = await callNetease("cloudsearch", {
      keywords: query,
      type: 1,
      offset: (page - 1) * limit,
      limit,
    });
    if (body?.code !== 200) throw new Error(body?.message ?? body?.msg ?? "Netease search failed");
    const songs = (body?.result?.songs ?? []) as NeteaseSong[];
    return result(
      platform,
      page,
      limit,
      body?.result?.songCount ?? songs.length,
      songs.map(neteaseToTrack),
    );
  }

  if (platform === "qqmusic") {
    const body = (await callQQMusic("search", {
      keywords: query,
      type: 0,
      page,
      limit,
    })) as { code?: number; message?: string; total?: number; songs?: QMSong[] };
    if (body.code !== 200) throw new Error(body.message ?? "QQ Music search failed");
    const songs = body.songs ?? [];
    return result(platform, page, limit, body.total ?? songs.length, songs.map(qqMusicToTrack));
  }

  const body = (await callKugou("search", { keywords: query, page, limit })) as {
    code?: number;
    message?: string;
    total?: number;
    songs?: KGSong[];
  };
  if (body.code !== 200) throw new Error(body.message ?? "Kugou search failed");
  const songs = body.songs ?? [];
  return result(platform, page, limit, body.total ?? songs.length, songs.map(kugouToTrack));
};
