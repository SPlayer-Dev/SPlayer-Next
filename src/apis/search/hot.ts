import { neteaseCall } from "@/apis/netease";

export interface HotSearchItem {
  /** 关键词 */
  keyword: string;
  /** 描述/补充 */
  content?: string;
  /** 图标 url */
  iconUrl?: string;
  /** 热度 */
  score?: number;
}

interface NeteaseHotDetailResp {
  data?: Array<{
    searchWord: string;
    score?: number;
    content?: string;
    iconUrl?: string;
    iconType?: number;
  }>;
}

const CACHE_TTL = 10 * 60 * 1000;

let cache: { items: HotSearchItem[]; at: number } | null = null;

/**
 * 取内置在线源热搜（按 TTL 缓存）
 */
export const getHotSearches = async (): Promise<HotSearchItem[]> => {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL) return cache.items;

  const res = await neteaseCall<NeteaseHotDetailResp>("search_hot_detail");
  const items: HotSearchItem[] = (res.data ?? [])
    .filter((row) => row.searchWord)
    .map((row) => ({
      keyword: row.searchWord,
      content: row.content,
      iconUrl: row.iconUrl,
      score: row.score,
    }));

  cache = { items, at: now };
  return items;
};
