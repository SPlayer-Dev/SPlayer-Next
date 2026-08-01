import { callNetease } from "@main/apis/netease";
import { coreLog } from "@main/utils/logger";
import type { MusicCommentCreatorQuery, MusicCommentItem } from "@shared/types/comment";
import { BoundedMap } from "./cache";
import { normalizeNeteaseCommentPage, optionalString, scanCreatorComments } from "./data";
import { findNeteaseSongMeta } from "./index";

const NETEASE_SOURCE_ID = "builtin:netease";
const NETEASE_RESOURCE_TYPE = "R_SO_4_";
const HOT_LIMIT = 20;
/** 首屏前两页未命中时，最多额外翻页数 */
const MAX_EXTRA_PAGES = 3;
/** 普通评论队列扫描最大页数，主创发布初期评论多在靠前页 */
const MAX_NEW_PAGES = 5;
const ARTIST_ACCOUNT_CACHE_LIMIT = 200;
const CREATOR_COMMENTS_CACHE_LIMIT = 100;

type ArtistAccountInfo = { accountId: string; artistName: string };

/** artist id → 绑定的网易云账号信息（null 表示负缓存：未绑定） */
const artistAccountIdCache = new BoundedMap<string, ArtistAccountInfo | null>(
  ARTIST_ACCOUNT_CACHE_LIMIT,
);
/** 网易云 songId → 主创评论列表（空数组表示负缓存：无主创评论） */
const creatorCommentsCache = new BoundedMap<string, MusicCommentItem[]>(
  CREATOR_COMMENTS_CACHE_LIMIT,
);

/** 拉取一页热门评论（归一化后返回） */
const fetchHotPage = async (
  songId: string,
  page: number,
): Promise<{ items: MusicCommentItem[]; hasMore: boolean }> => {
  const { body } = await callNetease("comment_hot", {
    id: songId,
    type: NETEASE_RESOURCE_TYPE,
    limit: HOT_LIMIT,
    offset: (page - 1) * HOT_LIMIT,
  });
  const normalized = normalizeNeteaseCommentPage(body, "hot", page, HOT_LIMIT);
  const hasMore = Boolean(body?.hasMore ?? body?.data?.hasMore ?? false);
  return { items: normalized.list, hasMore };
};

/** 拉取一页普通评论（归一化后返回），用于补充主创低赞评论 */
const fetchNewPage = async (
  songId: string,
  page: number,
): Promise<{ items: MusicCommentItem[]; hasMore: boolean }> => {
  const { body } = await callNetease("comment_music", {
    id: songId,
    type: NETEASE_RESOURCE_TYPE,
    limit: HOT_LIMIT,
    offset: (page - 1) * HOT_LIMIT,
  });
  const normalized = normalizeNeteaseCommentPage(body, "new", page, HOT_LIMIT);
  const hasMore = Boolean(body?.hasMore ?? body?.data?.hasMore ?? false);
  return { items: normalized.list, hasMore };
};

/**
 * 解析歌手列表对应的网易云账号 → 歌手名映射
 * 多歌手多账号匹配并去重；accountId 为 0 或不存在视为未绑定（负缓存）
 * @param artistIds - 歌手 id 列表
 * @returns accountId → 歌手名
 */
const resolveArtistAccountIds = async (artistIds: string[]): Promise<Map<string, string>> => {
  const accountToName = new Map<string, string>();
  const uniqueIds = [...new Set(artistIds.filter((id) => !!id))];
  await Promise.all(
    uniqueIds.map(async (artistId) => {
      const cached = artistAccountIdCache.get(artistId);
      if (cached !== undefined) {
        if (cached) accountToName.set(cached.accountId, cached.artistName);
        return;
      }
      try {
        const { body } = await callNetease("artists", { id: artistId });
        const rawAccountId = body?.artist?.accountId;
        const accountId =
          typeof rawAccountId === "number" && rawAccountId > 0
            ? String(rawAccountId)
            : typeof rawAccountId === "string" && rawAccountId
              ? rawAccountId
              : null;
        const artistName = optionalString(body?.artist?.name) ?? "";
        if (accountId) {
          artistAccountIdCache.set(artistId, { accountId, artistName });
          accountToName.set(accountId, artistName);
        } else {
          artistAccountIdCache.set(artistId, null);
        }
      } catch (err) {
        coreLog.warn(`[comments] resolve artist ${artistId} accountId failed:`, err);
        artistAccountIdCache.set(artistId, null);
      }
    }),
  );
  return accountToName;
};

/**
 * 获取「主创说」评论：歌曲关联歌手在网易云绑定的账号，在该歌曲热门评论与普通评论中的发言
 * 仅网易云内建源启用；热评前两页必拉，未命中且 hasMore 时额外翻页最多 MAX_EXTRA_PAGES 页；
 * 随后扫描普通评论队列最多 MAX_NEW_PAGES 页补充低赞主创评论，按 commentId 去重后按 likedCount 降序
 */
export const getCreatorComments = async (
  args: MusicCommentCreatorQuery,
): Promise<MusicCommentItem[]> => {
  if (args.sourceId !== NETEASE_SOURCE_ID) return [];

  const meta = await findNeteaseSongMeta(args.track);
  if (!meta) return [];
  const { songId, artistIds } = meta;

  const cached = creatorCommentsCache.get(songId);
  if (cached) return cached;

  const accountMap = await resolveArtistAccountIds(artistIds);
  if (accountMap.size === 0) {
    creatorCommentsCache.set(songId, []);
    return [];
  }

  const result: MusicCommentItem[] = [];
  // 前两页并发拉取；第 1 页已无更多时丢弃第 2 页结果，保持与顺序拉取一致
  const [firstPage, secondPage] = await Promise.all([
    fetchHotPage(songId, 1),
    fetchHotPage(songId, 2),
  ]);
  result.push(...scanCreatorComments(firstPage.items, accountMap));
  let hasMore = firstPage.hasMore;
  if (hasMore) {
    result.push(...scanCreatorComments(secondPage.items, accountMap));
    hasMore = secondPage.hasMore;
  }
  // 前两页无命中 + 还有更多 → 额外翻页，命中即停
  if (result.length === 0 && hasMore) {
    for (let extra = 1; extra <= MAX_EXTRA_PAGES && hasMore; extra++) {
      const { items, hasMore: hm } = await fetchHotPage(songId, 2 + extra);
      const hits = scanCreatorComments(items, accountMap);
      result.push(...hits);
      hasMore = hm;
      if (hits.length > 0) break;
    }
  }

  // 并发扫描普通评论队列补充主创低赞评论，按 commentId 去重（热评优先保留）；
  // hasMore=false 的页仍有数据须先处理，处理完再丢弃其后的页
  const seenIds = new Set(result.map((c) => c.id));
  const newPages = await Promise.all(
    Array.from({ length: MAX_NEW_PAGES }, (_, i) => fetchNewPage(songId, i + 1)),
  );
  for (const { items, hasMore: pageHasMore } of newPages) {
    const hits = scanCreatorComments(items, accountMap);
    for (const hit of hits) {
      if (!seenIds.has(hit.id)) {
        seenIds.add(hit.id);
        result.push(hit);
      }
    }
    if (!pageHasMore) break;
  }

  // 合并后按 likedCount 降序，无该字段的沉底
  result.sort((a, b) => (b.likedCount ?? -Infinity) - (a.likedCount ?? -Infinity));

  creatorCommentsCache.set(songId, result);
  return result;
};
