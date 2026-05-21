import localforage from "localforage";
import type { Track } from "@shared/types/player";
import { fetchDailySongs } from "@/apis/recommend/netease";

const MAX_SEARCH_HISTORY = 20;
/** 每日推荐 IndexedDB 缓存键 */
const DAILY_RECOMMEND_KEY = "daily-recommend";

const cacheDb = localforage.createInstance({ name: "splayer", storeName: "data-cache" });

/** 本地日期 key，用于判断每日数据是否过期 */
const todayKey = (): string => new Date().toDateString();

/** 每日推荐 IndexedDB 缓存结构 */
interface DailyRecommendCache {
  date: string;
  tracks: Track[];
}

/**
 * 通用本地数据 store
 * 用于沉淀那些跨页面、需持久化、但不归属任何业务模块的小块数据
 */
export const useDataStore = defineStore(
  "data",
  () => {
    /** 搜索历史（最新在前，去重，最多 20 条） */
    const searchHistory = ref<string[]>([]);

    /** 写入搜索历史 */
    const addSearchHistory = (keyword: string): void => {
      const word = keyword.trim();
      if (!word) return;
      const next = [word, ...searchHistory.value.filter((existing) => existing !== word)];
      if (next.length > MAX_SEARCH_HISTORY) next.length = MAX_SEARCH_HISTORY;
      searchHistory.value = next;
    };

    /** 移除某条搜索历史 */
    const removeSearchHistory = (keyword: string): void => {
      searchHistory.value = searchHistory.value.filter((existing) => existing !== keyword);
    };

    /** 清空搜索历史 */
    const clearSearchHistory = (): void => {
      searchHistory.value = [];
    };

    /** 每日推荐曲目 */
    const dailyRecommend = shallowRef<Track[]>([]);
    /** dailyRecommend 对应的日期 */
    let dailyRecommendDate = "";
    /** 进行中的拉取，去重并发调用 */
    let dailyRecommendLoading: Promise<Track[]> | null = null;

    /**
     * 取每日推荐曲目：当天已有直接返回，否则按 IndexedDB → 网络 顺序获取并落库
     * 跨天自动失效重拉，失败返回空数组。各处可直接调用，已就绪时即时返回
     */
    const ensureDailyRecommend = async (): Promise<Track[]> => {
      if (dailyRecommendDate === todayKey() && dailyRecommend.value.length > 0) {
        return dailyRecommend.value;
      }
      if (dailyRecommendLoading) return dailyRecommendLoading;
      dailyRecommendLoading = (async () => {
        try {
          const cached = await cacheDb
            .getItem<DailyRecommendCache>(DAILY_RECOMMEND_KEY)
            .catch(() => null);
          if (cached?.date === todayKey() && cached.tracks.length > 0) {
            dailyRecommend.value = cached.tracks;
            dailyRecommendDate = cached.date;
            return cached.tracks;
          }
          const tracks = await fetchDailySongs();
          if (tracks.length > 0) {
            dailyRecommend.value = tracks;
            dailyRecommendDate = todayKey();
            cacheDb
              .setItem(DAILY_RECOMMEND_KEY, { date: dailyRecommendDate, tracks })
              .catch(() => {});
          }
          return dailyRecommend.value;
        } catch (error) {
          console.warn("[data] daily recommend failed:", error);
          return dailyRecommend.value;
        } finally {
          dailyRecommendLoading = null;
        }
      })();
      return dailyRecommendLoading;
    };

    return {
      searchHistory,
      addSearchHistory,
      removeSearchHistory,
      clearSearchHistory,
      dailyRecommend,
      ensureDailyRecommend,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: ["searchHistory"],
    },
  },
);
