import type {
  CommentSource,
  CommentTab,
  MusicCommentItem,
  MusicCommentPage,
} from "@shared/types/comment";
import type { PluginInfo } from "@shared/types/plugin";
import { PLATFORM_SHORT_NAME } from "@shared/types/platform";

interface NeteaseUser {
  userId?: string | number;
  nickname?: string;
  avatarUrl?: string;
}

interface NeteaseComment {
  commentId?: string | number;
  beRepliedCommentId?: string | number;
  content?: string;
  time?: number;
  likedCount?: number;
  liked?: boolean;
  ipLocation?: {
    location?: string;
  };
  user?: NeteaseUser;
  beReplied?: NeteaseComment[];
  replyCount?: number;
}

interface NeteaseCommentBody {
  total?: number;
  hotComments?: NeteaseComment[];
  comments?: NeteaseComment[];
  data?: {
    totalCount?: number;
    comments?: NeteaseComment[];
    parentComment?: NeteaseComment;
    hasMore?: boolean;
  };
}

interface QQMusicComment {
  Avatar?: string;
  CmId?: string;
  Content?: string;
  EncryptUin?: string;
  Location?: string;
  Nick?: string;
  Pic?: string;
  PraiseNum?: number;
  PubTime?: number;
  ReplyCnt?: number;
  RepliedComments?: QQMusicComment[];
  SubComments?: QQMusicComment[];
}

export interface QQMusicCommentBody {
  comments?: QQMusicComment[];
  total?: number;
  hasMore?: boolean;
  nextCursor?: string;
}

interface KugouCommentImage {
  url?: string;
}

interface KugouComment {
  id?: string | number;
  content?: string;
  addtime?: string;
  user_id?: string | number;
  user_name?: string;
  user_pic?: string;
  location?: string;
  reply_num?: number;
  like?: {
    count?: number;
  };
  images?: KugouCommentImage[];
}

export interface KugouCommentBody {
  count?: number;
  current_page?: number;
  list?: KugouComment[];
  data?: {
    count?: number;
    current_page?: number;
    list?: KugouComment[];
  };
}

const toStringId = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
};

const optionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text || undefined;
};

/** 转换网易云评论项 */
export const normalizeNeteaseComment = (raw: NeteaseComment): MusicCommentItem | null => {
  const id = toStringId(raw.commentId ?? raw.beRepliedCommentId);
  const text = optionalString(raw.content);
  if (!id || !text) return null;

  const userId = toStringId(raw.user?.userId);
  const reply = (raw.beReplied ?? [])
    .map((item) => normalizeNeteaseComment(item))
    .filter((item): item is MusicCommentItem => item !== null);

  const item: MusicCommentItem = {
    id,
    userName: optionalString(raw.user?.nickname) ?? "",
    text,
  };
  if (userId) item.userId = userId;
  const avatar = optionalString(raw.user?.avatarUrl);
  if (avatar) item.avatar = avatar;
  if (typeof raw.time === "number") item.time = raw.time;
  const location = optionalString(raw.ipLocation?.location);
  if (location) item.location = location;
  if (typeof raw.likedCount === "number") item.likedCount = raw.likedCount;
  if (typeof raw.replyCount === "number") item.replyTotal = raw.replyCount;
  if (reply.length) item.reply = reply;
  return item;
};

/** 转换网易云评论分页 */
export const normalizeNeteaseCommentPage = (
  body: NeteaseCommentBody,
  type: CommentTab,
  page: number,
  limit: number,
): MusicCommentPage => {
  const rawList =
    type === "hot"
      ? (body.hotComments ?? body.data?.comments ?? [])
      : (body.comments ?? body.data?.comments ?? []);
  const list = rawList
    .map((item) => normalizeNeteaseComment(item))
    .filter((item): item is MusicCommentItem => item !== null);

  return {
    list,
    total: body.total ?? body.data?.totalCount ?? list.length,
    page,
    limit,
  };
};

/** 转换 QM 评论项 */
export const normalizeQQMusicComment = (raw: QQMusicComment): MusicCommentItem | null => {
  const id = optionalString(raw.CmId);
  const text = optionalString(raw.Content);
  if (!id || !text) return null;
  const rawReplies = raw.RepliedComments?.length ? raw.RepliedComments : raw.SubComments;
  const reply = (rawReplies ?? [])
    .map((item) => normalizeQQMusicComment(item))
    .filter((item): item is MusicCommentItem => item !== null);
  const item: MusicCommentItem = {
    id,
    userName: optionalString(raw.Nick) ?? "",
    text,
  };
  const userId = optionalString(raw.EncryptUin);
  if (userId) item.userId = userId;
  const avatar = optionalString(raw.Avatar)?.replace(/^http:/, "https:");
  if (avatar) item.avatar = avatar;
  if (typeof raw.PubTime === "number") item.time = raw.PubTime * 1000;
  const location = optionalString(raw.Location);
  if (location) item.location = location;
  if (typeof raw.PraiseNum === "number") item.likedCount = raw.PraiseNum;
  if (typeof raw.ReplyCnt === "number") item.replyTotal = raw.ReplyCnt;
  const image = optionalString(raw.Pic)?.replace(/^http:/, "https:");
  if (image) item.images = [image];
  if (reply.length) item.reply = reply;
  return item;
};

/** 转换 QM 评论分页 */
export const normalizeQQMusicCommentPage = (
  body: QQMusicCommentBody,
  page: number,
  limit: number,
): MusicCommentPage => {
  const list = (body.comments ?? [])
    .map((item) => normalizeQQMusicComment(item))
    .filter((item): item is MusicCommentItem => item !== null);
  return {
    list,
    total: body.total ?? list.length,
    page,
    limit,
    ...(body.hasMore && body.nextCursor ? { nextCursor: body.nextCursor } : {}),
  };
};

/** 转换 KG 评论项 */
export const normalizeKugouComment = (raw: KugouComment): MusicCommentItem | null => {
  const id = toStringId(raw.id);
  const text = optionalString(raw.content);
  if (!id || !text) return null;

  const item: MusicCommentItem = {
    id,
    userName: optionalString(raw.user_name) ?? "",
    text,
  };
  const userId = toStringId(raw.user_id);
  if (userId) item.userId = userId;
  const avatar = optionalString(raw.user_pic);
  if (avatar) item.avatar = avatar;
  const time = optionalString(raw.addtime);
  if (time) {
    const timestamp = new Date(time.replace(" ", "T")).getTime();
    if (Number.isFinite(timestamp)) item.time = timestamp;
  }
  const location = optionalString(raw.location);
  if (location) item.location = location;
  if (typeof raw.like?.count === "number") item.likedCount = raw.like.count;
  if (typeof raw.reply_num === "number") item.replyTotal = raw.reply_num;
  const images = (raw.images ?? [])
    .map((image) => optionalString(image.url))
    .filter((image): image is string => Boolean(image));
  if (images.length) item.images = images;
  return item;
};

/** 转换 KG 评论分页 */
export const normalizeKugouCommentPage = (
  body: KugouCommentBody,
  page: number,
  limit: number,
): MusicCommentPage => {
  const data = body.data ?? body;
  const list = (data.list ?? [])
    .map((item) => normalizeKugouComment(item))
    .filter((item): item is MusicCommentItem => item !== null);
  return {
    list,
    total: data.count ?? list.length,
    page: data.current_page ?? page,
    limit,
  };
};

/** 构建可用评论源 */
export const buildCommentSources = (
  plugins: Array<
    Pick<PluginInfo, "enabled"> & {
      manifest: Pick<PluginInfo["manifest"], "id" | "name">;
      status: PluginInfo["status"];
    }
  >,
): CommentSource[] => {
  const sources: CommentSource[] = [
    {
      id: "builtin:netease",
      name: PLATFORM_SHORT_NAME.netease,
      kind: "builtin",
      platform: "netease",
    },
    {
      id: "builtin:qqmusic",
      name: PLATFORM_SHORT_NAME.qqmusic,
      kind: "builtin",
      platform: "qqmusic",
    },
    {
      id: "builtin:kugou",
      name: PLATFORM_SHORT_NAME.kugou,
      kind: "builtin",
      platform: "kugou",
      tabs: ["hot"],
    },
  ];

  for (const info of plugins) {
    if (!info.enabled || info.status.state !== "ready") continue;
    for (const [source, cap] of Object.entries(info.status.sources)) {
      if (!cap.actions.includes("musicSearch") || !cap.actions.includes("musicComment")) continue;
      sources.push({
        id: `plugin:${info.manifest.id}:${source}`,
        name: cap.name,
        kind: "plugin",
        pluginId: info.manifest.id,
        pluginSource: source,
      });
    }
  }

  return sources;
};
