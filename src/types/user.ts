/**
 * 用户登录相关类型
 */

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
  /** 收藏专辑数 */
  albumCount?: number;
  /** 收藏歌手数 */
  artistCount: number;
}
