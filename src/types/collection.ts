import type { Track, Artist, TrackSource } from "@shared/types/player";

/** 本地与在线内容范围 */
export type ContentScope = "local" | "online";

/** 合集类型 */
export type CollectionType = "album" | "playlist" | "radio" | "cloud";

/** 合集信息 */
export interface Collection {
  id: string;
  type: CollectionType;
  /** 数据来源 */
  source: TrackSource;
  /** 标题 */
  title: string;
  /** 封面 */
  cover?: string;
  /** 描述 */
  description?: string;
  /** 创建者/歌手 */
  creator?: string;
  /** 歌手列表（专辑用） */
  artists?: Artist[];
  /** 歌曲列表 */
  tracks: Track[];
  /** 歌曲数量 */
  trackCount?: number;
  /** 创建时间（Unix ms） */
  createTime?: number;
  /** 更新时间（Unix ms） */
  updateTime?: number;
  /** 播放次数（在线歌单来源） */
  playCount?: number;
}
