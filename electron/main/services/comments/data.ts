import type {
  CommentSource,
  CommentTab,
  MusicCommentItem,
  MusicCommentPage,
} from "@shared/types/comment";
import type { PluginInfo } from "@shared/types/plugin";

const NETEASE_SOURCE_NAME = "NCM";

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
      name: NETEASE_SOURCE_NAME,
      kind: "builtin",
      platform: "netease",
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
