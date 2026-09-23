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
