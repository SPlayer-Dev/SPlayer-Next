/**
 * 用户登录相关类型
 */

import type { Track } from "@shared/types/player";

/** 用户基础资料 */
export interface UserProfile {
  userId: number;
  nickname: string;
  avatarUrl?: string;
  backgroundUrl?: string;
  signature?: string;
  /** 0=普通，非 0=黑胶 VIP */
  vipType?: number;
  gender?: number;
  province?: number;
  city?: number;
}

/** 用户订阅计数（/user/subcount） */
export interface UserSubcount {
  /** 自建歌单数 */
  createdPlaylistCount: number;
  /** 收藏歌单数 */
  subPlaylistCount: number;
  /** 收藏歌手数 */
  artistCount: number;
}

/** 听歌排行范围：1 最近一周；0 所有时间 */
export type PlayRankingRange = 0 | 1;

/** 听歌排行条目（/api/v1/play/record） */
export interface PlayRankingEntry {
  /** 曲目 */
  track: Track;
  /** 播放次数 */
  playCount: number;
}
