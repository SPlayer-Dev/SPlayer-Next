import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import type { NeteaseSong } from "@/types/netease";
import { netease as neteaseApi } from "@/apis/netease";
import {
  ensureOk,
  songsToTracks,
  withPicSize,
  toPlaylist,
  toArtist,
  toAlbum,
} from "@/utils/format/netease";
import { playlistToCoverItem, artistToCoverItem, albumToCoverItem } from "@/utils/format/coverItem";

/** 每日推荐歌曲（每日 30 首，需登录） */
export const fetchDailySongs = async (): Promise<Track[]> => {
  const body = await neteaseApi.recommend_songs({ timestamp: Date.now() });
  return songsToTracks(body?.data?.dailySongs);
};

interface FollowedArtistPlayAllResponse {
  code?: number;
  data?: {
    count?: number;
    songList?: NeteaseSong[];
  };
}

/** 播放所有关注歌手最近的 50 首新歌（需登录） */
export const fetchFollowedArtistPlayAll = async (): Promise<Track[]> => {
  const body = ensureOk(await neteaseApi.artist_new_song_playall<FollowedArtistPlayAllResponse>());
  return songsToTracks(body.data?.songList);
};

interface RawNewReleaseTitle {
  artistName: string;
  artistId: number;
  artistUserId?: number;
  imgUrl?: string;
  resourceId: number;
  resourceName: string;
  resourcePicUrl?: string;
  publishTime: number;
}

interface RawNewReleaseWork {
  sourceType: number;
  info?: {
    blockTitle?: RawNewReleaseTitle;
    blockType?: string;
    songLists?: NeteaseSong[];
    publishTime?: number;
    albumSongCount?: number;
  };
}

interface FollowedArtistNewWorksResponse {
  code?: number;
  data?: {
    hasMore?: boolean;
    latestVisitTime?: number;
    newSongCount?: number;
    newWorks?: RawNewReleaseWork[];
  };
}

export interface FollowedArtistNewWork {
  id: string;
  sourceType: number;
  blockType: string;
  artistId: string;
  artistName: string;
  artistAvatar?: string;
  resourceId: string;
  resourceName: string;
  resourceCover?: string;
  publishTime: number;
  albumSongCount: number;
  tracks: Track[];
}

export interface FollowedArtistNewWorksPage {
  works: FollowedArtistNewWork[];
  hasMore: boolean;
  newSongCount: number;
  nextTimestamp?: number;
}

/** 关注歌手新歌发布流，按歌手和专辑/单曲分块 */
export const fetchFollowedArtistNewWorks = async (params: {
  startTimestamp: number;
  firstRequest: boolean;
  limit?: number;
}): Promise<FollowedArtistNewWorksPage> => {
  const body = ensureOk(
    await neteaseApi.artist_new_song_mv_list_v2<FollowedArtistNewWorksResponse>({
      startTimestamp: params.startTimestamp,
      sourceType: 1,
      limit: params.limit ?? 10,
      firstRequest: params.firstRequest,
    }),
  );
  const works = (body.data?.newWorks ?? []).flatMap<FollowedArtistNewWork>((raw) => {
    const title = raw.info?.blockTitle;
    if (!title) return [];
    const tracks = songsToTracks(raw.info?.songLists);
    return [
      {
        id: `${raw.sourceType}:${title.resourceId}:${title.publishTime}`,
        sourceType: raw.sourceType,
        blockType: raw.info?.blockType ?? "song",
        artistId: String(title.artistId),
        artistName: title.artistName,
        artistAvatar: withPicSize(title.imgUrl, 100),
        resourceId: String(title.resourceId),
        resourceName: title.resourceName,
        resourceCover: withPicSize(title.resourcePicUrl) ?? tracks[0]?.cover,
        publishTime: raw.info?.publishTime ?? title.publishTime,
        albumSongCount: raw.info?.albumSongCount ?? tracks.length,
        tracks,
      },
    ];
  });
  const lastTimestamp = works.at(-1)?.publishTime;
  return {
    works,
    hasMore: body.data?.hasMore ?? false,
    newSongCount: body.data?.newSongCount ?? 0,
    nextTimestamp: lastTimestamp === undefined ? undefined : Math.max(0, lastTimestamp - 1),
  };
};

/**
 * 心动模式智能播放列表
 * @param seedId - 种子歌曲 id
 * @param playlistId - 歌单 id（「我喜欢的音乐」）
 * @returns 智能推荐的 Track 列表
 */
export const fetchHeartModeList = async (seedId: string, playlistId: string): Promise<Track[]> => {
  const body = await neteaseApi.playmode_intelligence<{ data?: { songInfo: NeteaseSong }[] }>({
    id: seedId,
    pid: playlistId,
  });
  return songsToTracks((body?.data ?? []).map((item) => item.songInfo));
};

/** 取一批私人 FM 推荐 */
export const fetchPersonalFm = async (): Promise<Track[]> => {
  const body = await neteaseApi.personal_fm<{ data?: NeteaseSong[] }>();
  return songsToTracks(body?.data ?? []);
};

/**
 * 私人 FM 减少推荐
 * @param songId - 歌曲 id
 * @param playedSec - 实际播放秒数，作为算法反馈
 */
export const submitFmTrash = async (songId: string, playedSec?: number): Promise<void> => {
  await neteaseApi.fm_trash({
    id: songId,
    ...(playedSec !== undefined ? { time: playedSec } : {}),
  });
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
