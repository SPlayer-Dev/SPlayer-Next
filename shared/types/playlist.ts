import type { Track } from "./player";

/** 歌单来源类型 */
export type PlaylistType = "local";

/** 歌单列表项 */
export interface PlaylistSummary {
  id: string;
  type: PlaylistType;
  title: string;
  description?: string;
  cover?: string;
  trackCount: number;
  createTime: number;
  updateTime: number;
}

/** 完整歌单 */
export interface PlaylistDetail extends PlaylistSummary {
  tracks: Track[];
}

/** 创建歌单参数 */
export interface PlaylistCreateInput {
  type: PlaylistType;
  title: string;
  description?: string;
}

/** 更新歌单参数 */
export interface PlaylistUpdateInput {
  title?: string;
  description?: string;
  cover?: string;
}

/** 旧版 renderer 歌单迁移记录 */
export interface LegacyPlaylistRecord {
  id: string;
  title: string;
  description?: string;
  cover?: string;
  trackIds: string[];
  createTime?: number;
  updateTime?: number;
}

/** renderer 可用的歌单 API */
export interface PlaylistApi {
  list: () => Promise<PlaylistSummary[]>;
  get: (id: string) => Promise<PlaylistDetail | null>;
  create: (input: PlaylistCreateInput) => Promise<PlaylistSummary>;
  update: (id: string, input: PlaylistUpdateInput) => Promise<PlaylistSummary | null>;
  remove: (id: string) => Promise<void>;
  addTracks: (id: string, trackIds: string[]) => Promise<number>;
  removeTracks: (id: string, trackIds: string[]) => Promise<number>;
  importLegacy: (records: LegacyPlaylistRecord[]) => Promise<void>;
  clear: () => Promise<void>;
}
