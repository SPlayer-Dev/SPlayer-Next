import { callNetease } from "@main/apis/netease";
import { coreLog } from "@main/utils/logger";
import type { MusicCommentCreatorQuery, MusicCommentItem } from "@shared/types/comment";
import { BoundedMap, coalesce } from "./cache";
import {
  normalizeNeteaseCommentPage,
  optionalString,
  scanCreatorComments,
  type NeteaseCommentBody,
} from "./data";
import { findNeteaseSongMeta } from "./index";

const NETEASE_SOURCE_ID = "builtin:netease";
const NETEASE_RESOURCE_TYPE = "R_SO_4_";
const PAGE_LIMIT = 20;
const MAX_HOT_PAGES = 3;
const MAX_NEW_PAGES = 5;
const ARTIST_ACCOUNT_CACHE_LIMIT = 200;
const CREATOR_COMMENTS_CACHE_LIMIT = 100;
const CREATOR_COMMENTS_TTL = 10 * 60 * 1000;

/** 歌手账号解析结果，failed 表示请求异常，不能当作未绑定 */
type ArtistAccountResult =
  | { state: "bound"; accountId: string; artistName: string }
  | { state: "unbound" }
  | { state: "failed" };

/** 歌手 id → 账号解析结果，只缓存确定结论 */
const artistAccountCache = new BoundedMap<string, ArtistAccountResult>(ARTIST_ACCOUNT_CACHE_LIMIT);
/** 网易云歌曲 id → 主创评论列表，空数组为负缓存 */
const creatorCommentsCache = new BoundedMap<string, MusicCommentItem[]>(
  CREATOR_COMMENTS_CACHE_LIMIT,
  CREATOR_COMMENTS_TTL,
);
/** 歌手账号解析在途请求 */
const artistAccountInflight = new Map<string, Promise<ArtistAccountResult>>();
/** 主创评论扫描在途请求 */
const creatorInflight = new Map<string, Promise<MusicCommentItem[]>>();

/**
 * 拉取一页网易云评论，非 200 状态抛错
 * @param songId - 网易云歌曲 id
 * @param type - 评论分类
 * @param page - 页码
 * @returns 归一化分页，含原生的 hasMore 信号
 */
const fetchPage = async (songId: string, type: "hot" | "new", page: number) => {
  const apiName = type === "hot" ? "comment_hot" : "comment_music";
  const { status, body } = await callNetease(apiName, {
    id: songId,
    type: NETEASE_RESOURCE_TYPE,
    limit: PAGE_LIMIT,
    offset: (page - 1) * PAGE_LIMIT,
  });
  if (status !== 200) throw new Error(`netease comment request failed: ${status}`);
  return normalizeNeteaseCommentPage(body as NeteaseCommentBody, type, page, PAGE_LIMIT);
};

/**
 * 解析单个歌手绑定的网易云账号
 * 请求异常时不下结论，避免一次超时被当成永久未绑定
 * @param artistId - 歌手 id
 * @returns 账号解析结果
 */
const resolveArtistAccount = async (artistId: string): Promise<ArtistAccountResult> => {
  const cached = artistAccountCache.get(artistId);
  if (cached !== undefined) return cached;
  return coalesce(artistAccountInflight, artistId, async () => {
    try {
      const { status, body } = await callNetease("artists", { id: artistId });
      if (status !== 200) throw new Error(`netease artist request failed: ${status}`);
      const rawAccountId = body?.artist?.accountId;
      const accountId =
        typeof rawAccountId === "number" && rawAccountId > 0
          ? String(rawAccountId)
          : typeof rawAccountId === "string" && rawAccountId
            ? rawAccountId
            : "";
      const result: ArtistAccountResult = accountId
        ? { state: "bound", accountId, artistName: optionalString(body?.artist?.name) ?? "" }
        : { state: "unbound" };
      artistAccountCache.set(artistId, result);
      return result;
    } catch (err) {
      coreLog.warn(`[comments] resolve artist ${artistId} accountId failed:`, err);
      return { state: "failed" };
    }
  });
};

/**
 * 解析歌手列表对应的网易云账号
 * @param artistIds - 歌手 id 列表
 * @returns 账号 id → 歌手名，以及是否存在解析失败的歌手
 */
const resolveArtistAccountIds = async (
  artistIds: string[],
): Promise<{ accountMap: Map<string, string>; failed: boolean }> => {
  const accountMap = new Map<string, string>();
  const uniqueIds = [...new Set(artistIds.filter(Boolean))];
  const results = await Promise.all(uniqueIds.map((artistId) => resolveArtistAccount(artistId)));
  let failed = false;
  for (const result of results) {
    if (result.state === "bound") accountMap.set(result.accountId, result.artistName);
    else if (result.state === "failed") failed = true;
  }
  return { accountMap, failed };
};

/**
 * 顺序翻页扫描主创评论，命中或没有下一页时停止
 * @param songId - 网易云歌曲 id
 * @param type - 评论分类
 * @param maxPages - 最多翻页数
 * @param accountMap - 账号 id → 歌手名
 * @returns 命中的主创评论
 */
const scanPages = async (
  songId: string,
  type: "hot" | "new",
  maxPages: number,
  accountMap: Map<string, string>,
): Promise<MusicCommentItem[]> => {
  const hits: MusicCommentItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchPage(songId, type, page);
    hits.push(...scanCreatorComments(data.list, accountMap));
    if (hits.length > 0 || data.hasMore !== true) break;
  }
  return hits;
};

/**
 * 获取主创说评论：歌曲关联歌手在网易云绑定的账号在该曲下的发言
 * 先扫热评，热评无命中时才扫普通评论，两个阶段都顺序按需翻页并命中即停
 * @param args - 评论源与曲目
 * @returns 按点赞数降序的主创评论
 */
export const getCreatorComments = async (
  args: MusicCommentCreatorQuery,
): Promise<MusicCommentItem[]> => {
  if (args.sourceId !== NETEASE_SOURCE_ID) return [];
  const meta = await findNeteaseSongMeta(args.track);
  if (!meta) return [];

  const cached = creatorCommentsCache.get(meta.songId);
  if (cached !== undefined) return cached;

  return coalesce(creatorInflight, meta.songId, async () => {
    const { accountMap, failed } = await resolveArtistAccountIds(meta.artistIds);
    if (accountMap.size === 0) {
      if (!failed) creatorCommentsCache.set(meta.songId, []);
      return [];
    }

    let result = await scanPages(meta.songId, "hot", MAX_HOT_PAGES, accountMap);
    if (result.length === 0) {
      result = await scanPages(meta.songId, "new", MAX_NEW_PAGES, accountMap);
    }

    const seen = new Set<string>();
    result = result.filter((item) => (seen.has(item.id) ? false : seen.add(item.id)));
    result.sort((a, b) => (b.likedCount ?? -1) - (a.likedCount ?? -1));
    if (!failed) creatorCommentsCache.set(meta.songId, result);
    return result;
  });
};
