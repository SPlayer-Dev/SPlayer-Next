/** 歌曲列表排序字段 */
export type SortField =
  | "none"
  | "title"
  | "artist"
  | "album"
  | "path"
  | "duration"
  | "size"
  | "mtime"
  | "ctime"
  | "track";

/** 歌曲列表排序方向 */
export type SortOrder = "asc" | "desc";

/** 歌曲列表排序偏好 */
export interface SongListSortPreference {
  field: SortField;
  order: SortOrder;
}

/**
 * 歌曲列表排序作用域
 * 使用固定枚举按页面类型隔离，避免按歌单/专辑实体无限增长
 */
export type SongListSortKey =
  | "library"
  | "folders"
  | "liked.local"
  | "liked.online"
  | "collection.album"
  | "collection.playlist"
  | "collection.radio"
  | "collection.cloud"
  | "artist"
  | "history"
  | "cloud";
