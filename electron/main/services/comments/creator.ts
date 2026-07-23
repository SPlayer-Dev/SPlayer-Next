import { callNetease } from "@main/apis/netease";
import { coreLog } from "@main/utils/logger";
import type { MusicCommentCreatorQuery, MusicCommentItem } from "@shared/types/comment";
import { normalizeNeteaseCommentPage, scanCreatorComments } from "./data";
import { findNeteaseSongMeta } from "./index";

const NETEASE_SOURCE_ID = "builtin:netease";
const NETEASE_RESOURCE_TYPE = "R_SO_4_";
const HOT_LIMIT = 20;
/** 首屏前两页未命中时，最多额外翻页数 */
const MAX_EXTRA_PAGES = 3;
const ARTIST_ACCOUNT_CACHE_LIMIT = 200;
const CREATOR_COMMENTS_CACHE_LIMIT = 100;

/**
 * 简易有界 LRU Map
 * Map 保持插入顺序，访问时移到末尾，超限时删除首项
 */
class BoundedMap<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly limit: number) {}

  has(key: K): boolean {
    return this.map.has(key);
  }

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined && this.map.size > 1) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.limit) {
      const first = this.map.keys().next().value;
      if (first === undefined) break;
      this.map.delete(first);
    }
  }
}

/** artist id → 绑定的网易云用户 accountId（null 表示负缓存：未绑定） */
const artistAccountIdCache = new BoundedMap<string, string | null>(ARTIST_ACCOUNT_CACHE_LIMIT);
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

/**
 * 解析歌手列表对应的网易云用户 accountId 集合
 * 多歌手多账号匹配并去重；accountId 为 0 或不存在视为未绑定（负缓存）
 */
const resolveArtistAccountIds = async (artistIds: string[]): Promise<Set<string>> => {
  const accountIds = new Set<string>();
  for (const artistId of artistIds) {
    if (!artistId) continue;
    const cached = artistAccountIdCache.get(artistId);
    if (cached !== undefined) {
      if (cached) accountIds.add(cached);
      continue;
    }
    try {
      const { body } = await callNetease("artists", { id: artistId });
      const raw = body?.artist?.accountId;
      const normalized =
        typeof raw === "number" && raw > 0
          ? String(raw)
          : typeof raw === "string" && raw
            ? raw
            : null;
      artistAccountIdCache.set(artistId, normalized);
      if (normalized) accountIds.add(normalized);
    } catch (err) {
      coreLog.warn(`[comments] resolve artist ${artistId} accountId failed:`, err);
      artistAccountIdCache.set(artistId, null);
    }
  }
  return accountIds;
};

/**
 * 获取「主创说」评论：歌曲关联歌手在网易云绑定的账号，在该歌曲热门评论中的发言
 * 仅网易云内建源启用；前两页必拉，未命中且 hasMore 时额外翻页最多 MAX_EXTRA_PAGES 页
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

  const accountIds = await resolveArtistAccountIds(artistIds);
  if (accountIds.size === 0) {
    creatorCommentsCache.set(songId, []);
    return [];
  }

  const result: MusicCommentItem[] = [];
  let hasMore = true;
  // 前两页必拉，收集全部命中
  for (let page = 1; page <= 2 && hasMore; page++) {
    const { items, hasMore: hm } = await fetchHotPage(songId, page);
    result.push(...scanCreatorComments(items, accountIds));
    hasMore = hm;
  }
  // 前两页无命中 + 还有更多 → 额外翻页，命中即停
  if (result.length === 0 && hasMore) {
    for (let extra = 1; extra <= MAX_EXTRA_PAGES && hasMore; extra++) {
      const { items, hasMore: hm } = await fetchHotPage(songId, 2 + extra);
      const hits = scanCreatorComments(items, accountIds);
      result.push(...hits);
      hasMore = hm;
      if (hits.length > 0) break;
    }
  }

  creatorCommentsCache.set(songId, result);
  return result;
};
