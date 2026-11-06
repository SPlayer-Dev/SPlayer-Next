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

export interface NeteaseCommentBody {
  total?: number;
  hotComments?: NeteaseComment[];
  comments?: NeteaseComment[];
  /** legacy 评论端点用顶层 more 表示还有下一页 */
  more?: boolean;
  hasMore?: boolean;
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

export const optionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text || undefined;
};

/**
 * 转换 NCM 评论项
 * @param raw - 原始评论数据
 * @param fallbackId - 回复项缺少自身 id 时的兜底，避免多条回复共享父 id
 * @returns 归一化评论，缺少 id 或正文时返回 null
 */
export const normalizeNeteaseComment = (
  raw: NeteaseComment,
  fallbackId?: { parentId: string; index: number },
): MusicCommentItem | null => {
  const id =
    toStringId(raw.commentId ?? raw.beRepliedCommentId) ||
    (fallbackId ? `${fallbackId.parentId}_reply_${fallbackId.index}` : "");
  const text = optionalString(raw.content);
  if (!id || !text) return null;

  const userId = toStringId(raw.user?.userId);
  const reply = (raw.beReplied ?? [])
    .map((item, index) => normalizeNeteaseComment(item, { parentId: id, index }))
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

/**
 * 转换 NCM 评论分页
 * @param body - 原始响应正文
 * @param type - 评论分类
 * @param page - 页码
 * @param limit - 每页数量
 * @returns 归一化分页，total 缺失时以 0 表示未知
 */
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
  // legacy 端点用顶层 more，新端点给出 data.hasMore
  const hasMore = body.more ?? body.hasMore ?? body.data?.hasMore;

  return {
    list,
    total: body.total ?? body.data?.totalCount ?? 0,
    page,
    limit,
    ...(typeof hasMore === "boolean" ? { hasMore } : {}),
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

/**
 * 转换 QM 评论分页
 * @param body - 原始响应正文
 * @param page - 页码
 * @param limit - 每页数量
 * @returns 归一化分页，仍有下一页时保留游标（允许空串）
 */
export const normalizeQQMusicCommentPage = (
  body: QQMusicCommentBody,
  page: number,
  limit: number,
): MusicCommentPage => {
  const list = (body.comments ?? [])
    .map((item) => normalizeQQMusicComment(item))
    .filter((item): item is MusicCommentItem => item !== null);
  const hasMore = typeof body.hasMore === "boolean" ? body.hasMore : undefined;
  return {
    list,
    total: body.total ?? 0,
    page,
    limit,
    ...(hasMore === undefined ? {} : { hasMore }),
    ...(hasMore ? { nextCursor: body.nextCursor ?? "" } : {}),
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
    total: data.count ?? 0,
    page: data.current_page ?? page,
    limit,
  };
};

/**
 * 从已归一化的评论中筛出主创评论，主创在粉丝评论下的回复同样计入
 * @param items - 已归一化的评论列表
 * @param accountMap - 网易云账号 id → 歌手名
 * @returns 命中的主创评论，creatorName 为对应歌手名
 */
export const scanCreatorComments = (
  items: MusicCommentItem[],
  accountMap: Map<string, string>,
): MusicCommentItem[] => {
  if (accountMap.size === 0) return [];
  const result: MusicCommentItem[] = [];
  const push = (item: MusicCommentItem, userId: string): void => {
    result.push({ ...item, creatorName: accountMap.get(userId) ?? "" });
  };
  for (const item of items) {
    const userId = item.userId;
    if (userId && accountMap.has(userId)) push(item, userId);
    for (const reply of item.reply ?? []) {
      const replyUserId = reply.userId;
      if (replyUserId && accountMap.has(replyUserId)) push(reply, replyUserId);
    }
  }
  return result;
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
