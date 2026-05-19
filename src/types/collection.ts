import type { Track, Artist, TrackSource } from "@shared/types/player";

/** 合集类型 */
export type CollectionType = "album" | "playlist" | "radio";

/** 内容范畴：本地 / 在线 */
export type ContentScope = "local" | "online";

/** 歌单持久化结构 */
export interface PlaylistRecord {
  id: string;
  type: CollectionType;
  source: TrackSource;
  title: string;
  description?: string;
  /** 歌曲 ID 列表 */
  trackIds: string[];
  trackCount?: number;
  cover?: string;
  createTime?: number;
  updateTime?: number;
}

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
}
