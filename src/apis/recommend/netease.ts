import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import type { NeteaseSong, PersonalFmOptions } from "@shared/types/platform/netease";
import { netease as neteaseApi } from "@/apis/netease";
import {
  songToTrack,
  songsToTracks,
  withPicSize,
  toPlaylist,
  toArtist,
  toAlbum,
  trackToNeteaseSong,
} from "@/utils/format/netease";
import { playlistToCoverItem, artistToCoverItem, albumToCoverItem } from "@/utils/format/coverItem";

/** 每日推荐歌曲（每日 30 首，需登录） */
export const fetchDailySongs = async (): Promise<Track[]> => {
  const body = await neteaseApi.recommend_songs({ timestamp: Date.now() });
  return songsToTracks(body?.data?.dailySongs);
};

/** 心动模式进入参数（与桌面端对齐） */
export interface HeartModeListOptions {
  /** fromPlayOne 以单曲为种子；fromPlayAll 以整个歌单为种子 */
  type?: "fromPlayOne" | "fromPlayAll";
  /** 推荐批次数，桌面端传歌单长度 */
  count?: number;
  /** 起始歌曲 id，桌面端传歌单第一首 */
  startMusicId?: string;
  /** 完整歌单，桌面端心动模式会携带 */
  starPlaylist?: Track[];
  /** 用户 id */
  uid?: number | string;
}

/**
 * 心动模式智能播放列表
 * @param seedId - 种子歌曲 id
 * @param playlistId - 歌单 id（「我喜欢的音乐」）
 * @param options - 与桌面端对齐的可选参数
 * @returns 智能推荐的 Track 列表
 */
export const fetchHeartModeList = async (
  seedId: string,
  playlistId: string,
  options?: HeartModeListOptions,
): Promise<Track[]> => {
  const body = await neteaseApi.playmode_intelligence<{
    data?: {
      id?: number | string;
      songInfo: NeteaseSong | null;
      recommended?: boolean;
      alg?: string;
    }[];
  }>({
    id: seedId,
    pid: playlistId,
    ...(options?.type ? { type: options.type } : {}),
    ...(options?.count ? { count: options.count } : {}),
    ...(options?.startMusicId ? { sid: options.startMusicId } : {}),
    ...(options?.starPlaylist
      ? { starPlaylist: options.starPlaylist.map(trackToNeteaseSong) }
      : {}),
    ...(options?.uid !== undefined ? { uid: options.uid } : {}),
  });
  const items = body?.data ?? [];
  const playlistById = new Map((options?.starPlaylist ?? []).map((track) => [track.id, track]));
  const tracks: Track[] = [];
  for (const item of items) {
    const fallback = playlistById.get(String(item.id));
    const track = item.songInfo ? songToTrack(item.songInfo) : fallback ? { ...fallback } : null;
    if (!track) continue;
    if (item.recommended) track.recommended = true;
    if (item.alg) track.algorithm = item.alg;
    tracks.push(track);
  }
  return tracks;
};

/** 心动模式续推结果 */
export interface HeartModeMoreResult {
  tracks: Track[];
  algMap: Record<string, string>;
}

/**
 * 心动模式「更多推荐」续推
 * @param songIds - 当前播放列表歌曲 id
 * @param currentPlaySongId - 当前播放歌曲 id
 * @returns 续推曲目与算法标记
 */
export const fetchMoreHeartModeSongs = async (
  songIds: string[],
  currentPlaySongId: string,
): Promise<HeartModeMoreResult> => {
  const body = await neteaseApi.homepage_more_rcmd_song<{
    data?: { songList?: (NeteaseSong & { alg?: string })[]; algMap?: Record<string, string> };
  }>({
    songIds,
    currentPlaySongId,
    source: "curlist_more_rcmd",
  });
  const songList = body?.data?.songList ?? [];
  const algMap = body?.data?.algMap ?? {};
  const tracks = songsToTracks(songList);
  tracks.forEach((track, index) => {
    const alg = algMap[track.id] ?? songList[index]?.alg;
    track.moreRcmd = true;
    if (alg) track.algorithm = alg;
  });
  return { tracks, algMap };
};

/**
 * 获取一批私人 FM 推荐曲目
 * @param options - 可选的 FM 模式与场景选项
 * @returns 推荐的 Track 列表
 */
export const fetchPersonalFm = async (options?: PersonalFmOptions): Promise<Track[]> => {
  const body = await neteaseApi.personal_fm<{ data?: NeteaseSong[] }>({
    ...(options?.mode ? { mode: options.mode } : {}),
    ...(options?.submode ? { submode: options.submode } : {}),
    ...(options?.limit ? { limit: options.limit } : {}),
  });
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
