import type { Track } from "./player";
import type { Platform } from "./platform";

/** 评论来源类型 */
export type CommentSourceKind = "builtin" | "plugin";

/** 评论分页类型 */
export type CommentTab = "hot" | "new";

/** 评论来源 */
export interface CommentSource {
  id: string;
  name: string;
  kind: CommentSourceKind;
  platform?: Platform;
  /** 该来源支持的评论标签，未声明时默认全部支持 */
  tabs?: CommentTab[];
  pluginId?: string;
  pluginSource?: string;
}

/** 单条歌曲评论 */
export interface MusicCommentItem {
  id: string;
  userId?: string;
  userName: string;
  avatar?: string;
  text: string;
  time?: number;
  location?: string;
  likedCount?: number;
  images?: string[];
  replyTotal?: number;
  reply?: MusicCommentItem[];
  hasMoreReply?: boolean;
}

/** 歌曲评论分页 */
export interface MusicCommentPage {
  list: MusicCommentItem[];
  total: number;
  page: number;
  limit: number;
  /** 下一页游标 */
  nextCursor?: string;
}

/** 评论查询参数 */
export interface MusicCommentQuery {
  sourceId: string;
  track: Track;
  type: CommentTab;
  page: number;
  limit: number;
  /** 当前页游标 */
  cursor?: string;
}

/** 评论 IPC 响应 */
export type MusicCommentResponse =
  { ok: true; data: MusicCommentPage } | { ok: false; error: string };

/** 渲染端评论 API */
export interface CommentsApi {
  sources: () => Promise<CommentSource[]>;
  get: (args: MusicCommentQuery) => Promise<MusicCommentResponse>;
}
