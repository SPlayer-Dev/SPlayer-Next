/**
 * 播放统计采集类型
 *
 * 渲染端构造、主进程写入 SQLite。直接带完整 Track,行即自包含、可还原重播。
 */

import type { Artist, Track } from "./player";

/** 一次播放的统计事件,写入 play_history */
export interface PlayEventInput {
  /** 完整曲目（播放当时的快照） */
  track: Track;
  /** 本次播放开始 unix ms */
  startedAt: number;
  /** 实际收听墙钟毫秒（扣掉暂停） */
  listenedMs: number;
}

/** 一次收藏变更事件,写入 favorite_history */
export interface FavoriteEventInput {
  /** 完整曲目（操作当时的快照） */
  track: Track;
  /** 收藏 / 取消收藏 */
  action: "add" | "remove";
}

/** 播放统计汇总 */
export interface PlayStatsSummary {
  /** 今日收听时长（毫秒） */
  todayListenedMs: number;
  /** 本周收听时长（毫秒） */
  weekListenedMs: number;
  /** 上周收听时长（毫秒，用于环比） */
  lastWeekListenedMs: number;
  /** 累计收听时长（毫秒） */
  totalListenedMs: number;
  /** 本周播放次数 */
  weekPlayCount: number;
  /** 累计播放次数 */
  totalPlayCount: number;
  /** 本周新增收藏数 */
  weekFavoriteAdds: number;
  /** 连续收听天数 */
  streakDays: number;
}

/** 一首高频曲目及其播放次数 */
export interface TopTrack {
  /** 曲目（播放当时的快照） */
  track: Track;
  /** 累计播放次数 */
  playCount: number;
}

/** 音乐库统计概览（本地曲库） */
export interface LibraryStats {
  /** 歌曲总数（不含被 CUE 分轨引用的容器整轨） */
  trackCount: number;
  /** 专辑数量（按专辑名去重） */
  albumCount: number;
  /** 歌手数量（按歌手名去重） */
  artistCount: number;
  /** 总时长（毫秒） */
  totalDurationMs: number;
  /** 总文件大小（字节） */
  totalFileSize: number;
  /** 格式（编码）分布，按曲目数倒序 */
  codecs: { codec: string; count: number }[];
}

/** 某天的播放统计，day 为本地时区 YYYY-MM-DD */
export interface DailyPlayStats {
  /** 日期（YYYY-MM-DD） */
  day: string;
  /** 该日播放次数 */
  playCount: number;
}

/** 某小时的播放统计，hour 为本地时区 0-23 */
export interface HourlyPlayStats {
  /** 小时 */
  hour: number;
  /** 播放次数 */
  playCount: number;
}

/** 一张高频专辑及其播放次数 */
export interface TopAlbum {
  /** 代表曲目 */
  track: Track;
  /** 累计播放次数 */
  playCount: number;
}

/** 一位高频歌手及其播放次数 */
export interface TopArtist {
  /** 歌手 */
  artist: Artist;
  /** 代表曲目 */
  track: Track;
  /** 累计播放次数 */
  playCount: number;
}

/** preload 暴露的统计 API */
export interface StatsApi {
  /** 记录一次播放 */
  recordPlay: (event: PlayEventInput) => void;
  /** 记录一次收藏变更 */
  recordFavorite: (event: FavoriteEventInput) => void;
  /** 取播放统计汇总 */
  getStatsSummary: () => Promise<PlayStatsSummary>;
  /** 取最常播放的曲目（按次数倒序） */
  getTopTracks: (limit: number) => Promise<TopTrack[]>;
  /** 取音乐库统计概览 */
  getLibraryStats: () => Promise<LibraryStats>;
  /** 取最近 N 天（含今天）的每日播放统计（按日期升序） */
  getPlayHistoryDaily: (days: number) => Promise<DailyPlayStats[]>;
  /** 取各小时的累计播放统计 */
  getPlayHistoryHourly: () => Promise<HourlyPlayStats[]>;
  /** 取最常播放的专辑（按次数倒序） */
  getTopAlbums: (limit: number) => Promise<TopAlbum[]>;
  /** 取最常播放的歌手（按次数倒序） */
  getTopArtists: (limit: number) => Promise<TopArtist[]>;
}
