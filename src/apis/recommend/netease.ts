import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { netease as neteaseApi } from "@/apis/netease";
import { songsToTracks, withPicSize, toPlaylist, toArtist, toAlbum } from "@/utils/format/netease";
import { playlistToCoverItem, artistToCoverItem, albumToCoverItem } from "@/utils/format/coverItem";

/** 每日推荐歌曲（每日 30 首，需登录） */
export const fetchDailySongs = async (): Promise<Track[]> => {
  const body = await neteaseApi.recommend_songs({ timestamp: Date.now() });
  return songsToTracks(body?.data?.dailySongs);
};

/** 首页推荐区块展示数 */
const HOME_GRID_LIMIT = 12;
/** personalized 拉取数 */
const PERSONALIZED_FETCH_LIMIT = 20;

interface RawRecommendPlaylist {
  id: number | string;
  name: string;
  picUrl?: string;
  copywriter?: string;
  trackCount?: number;
}

/** 推荐歌单原始结构 → 封面卡片 */
const playlistToCover = (raw: RawRecommendPlaylist): CoverItem => ({
  id: String(raw.id),
  title: raw.name,
  cover: withPicSize(raw.picUrl),
  subtitle: raw.copywriter || undefined,
  trackCount: raw.trackCount ?? 0,
});

/**
 * 推荐歌单
 * 已登录取每日专属歌单（recommend/resource），未登录取通用推荐（personalized）；
 * 过滤掉「私人雷达」类个性化歌单
 * @param loggedIn - 是否已登录
 * @returns 歌单封面卡片列表
 */
export const fetchRecommendPlaylists = async (loggedIn: boolean): Promise<CoverItem[]> => {
  const list = loggedIn
    ? ((await neteaseApi.recommend_resource<{ recommend?: RawRecommendPlaylist[] }>())?.recommend ??
      [])
    : ((
        await neteaseApi.personalized<{ result?: RawRecommendPlaylist[] }>({
          limit: PERSONALIZED_FETCH_LIMIT,
        })
      )?.result ?? []);
  return list
    .filter((raw) => !raw.name.includes("雷达"))
    .slice(0, HOME_GRID_LIMIT)
    .map(playlistToCover);
};

/** 雷达歌单固定 id（私人 / 会员 / 时光 / 乐迷 / 宝藏 / 新歌 / 神秘） */
const RADAR_PLAYLIST_IDS = [
  "3136952023",
  "8402996200",
  "5320167908",
  "5327906368",
  "5362359247",
  "5300458264",
  "5341776086",
];

/**
 * 雷达歌单
 * 按固定 id 逐个取歌单详情组装成封面卡片，个别失败不影响整体
 * @returns 雷达歌单封面卡片列表
 */
export const fetchRadarPlaylists = async (): Promise<CoverItem[]> => {
  const results = await Promise.allSettled(
    RADAR_PLAYLIST_IDS.map((id) => neteaseApi.playlist_detail({ id })),
  );
  const covers: CoverItem[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value?.playlist) {
      covers.push(playlistToCoverItem(toPlaylist(result.value.playlist)));
    }
  }
  return covers;
};

/**
 * 热门歌手
 * @returns 歌手封面卡片列表
 */
export const fetchArtists = async (): Promise<CoverItem[]> => {
  const body = await neteaseApi.top_artists<{ artists?: unknown[] }>({ limit: HOME_GRID_LIMIT });
  return (body?.artists ?? []).map((raw) => artistToCoverItem(toArtist(raw)));
};

/**
 * 新碟上架
 * @returns 专辑封面卡片列表
 */
export const fetchNewAlbums = async (): Promise<CoverItem[]> => {
  const body = await neteaseApi.album_new<{ albums?: unknown[] }>({ limit: HOME_GRID_LIMIT });
  return (body?.albums ?? []).map((raw) => albumToCoverItem(toAlbum(raw)));
};
