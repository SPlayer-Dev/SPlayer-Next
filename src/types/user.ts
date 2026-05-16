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
