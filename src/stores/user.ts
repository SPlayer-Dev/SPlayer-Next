import type { Album, Artist, Playlist } from "@shared/types/player";
import type { UserProfile, UserSubcount } from "@/types/user";
import { clearNeteaseSession } from "@/apis/netease";
import {
  fetchLoginStatus,
  refreshLogin as refreshLoginApi,
  logoutNetease,
} from "@/apis/login/netease";
import {
  fetchLikelist,
  fetchSubcount,
  fetchUserAlbums,
  fetchUserArtists,
  fetchUserLevel,
  fetchUserPlaylists,
  toggleLikeSong,
} from "@/apis/user/netease";

/** 登录 cookie 保活间隔 */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

const emptySubcount = (): UserSubcount => ({
  createdPlaylistCount: 0,
  subPlaylistCount: 0,
  artistCount: 0,
});

export const useUserStore = defineStore(
  "user",
  () => {
    /** 用户基础资料 */
    const profile = ref<UserProfile | null>(null);
    /** 上一次 login_refresh 时间戳（毫秒） */
    const lastRefreshAt = ref<number>(0);
    /** 是否已登录 */
    const isLoggedIn = computed(() => profile.value !== null);

    /** 全部歌单（创建+收藏；首条恒为「我喜欢的音乐」） */
    const playlists = shallowRef<Playlist[]>([]);
    /** 红心歌曲 id 集合（Set 用于 O(1) 判定） */
    const likedSongIds = ref<Set<string>>(new Set());
    /** 收藏专辑 */
    const albums = shallowRef<Album[]>([]);
    /** 收藏歌手 */
    const artists = shallowRef<Artist[]>([]);
    /** 用户等级 */
    const level = ref<number | undefined>(undefined);
    /** 订阅计数 */
    const subcount = ref<UserSubcount>(emptySubcount());
    /** 内容拉取最近时间（ms） */
    const lastFetchedAt = ref<number>(0);
    /** 是否在拉内容 */
    const contentLoading = ref(false);

    /** 「我喜欢的音乐」歌单 id（数组首条） */
    const likedPlaylistId = computed<string | null>(() => playlists.value[0]?.id ?? null);

    /**
     * 自建歌单（含我喜欢；按 createdPlaylistCount 切分）
     * NCM /user/playlist 返回数组前 createdPlaylistCount 条为自建，其后为收藏
     */
    const createdPlaylists = computed<Playlist[]>(() => {
      const n = subcount.value.createdPlaylistCount || 0;
      if (n <= 0) return playlists.value.slice(0, 1);
      return playlists.value.slice(0, n);
    });

    /** 收藏歌单 */
    const subscribedPlaylists = computed<Playlist[]>(() => {
      const n = subcount.value.createdPlaylistCount || 0;
      return playlists.value.slice(n > 0 ? n : 1);
    });

    /** 是否红心 */
    const isLiked = (trackId: string): boolean => likedSongIds.value.has(trackId);

    /** 清空所有用户内容 */
    const clearContent = (): void => {
      playlists.value = [];
      likedSongIds.value = new Set();
      albums.value = [];
      artists.value = [];
      level.value = undefined;
      subcount.value = emptySubcount();
      lastFetchedAt.value = 0;
    };

    /**
     * 全量拉取用户内容（歌单 + 喜欢 id + 收藏专辑/歌手 + 计数）
     * 并行发起，失败的子任务不会阻塞其他类目
     */
    const loadContent = async (uid: number): Promise<void> => {
      if (!uid) return;
      contentLoading.value = true;
      try {
        const sub = await fetchSubcount().catch((err) => {
          console.warn("[user] subcount failed:", err);
          return emptySubcount();
        });
        subcount.value = sub;

        // 用 subcount 推算歌单 limit，避免一次请求带回上千条
        const playlistTotal = (sub.createdPlaylistCount || 0) + (sub.subPlaylistCount || 0) || 50;

        const settled = await Promise.allSettled([
          fetchUserPlaylists(uid, playlistTotal),
          fetchLikelist(uid),
          fetchUserAlbums(),
          fetchUserArtists(),
          fetchUserLevel(),
        ]);

        const [plRes, likeRes, albumRes, artistRes, levelRes] = settled;
        if (plRes.status === "fulfilled") playlists.value = plRes.value;
        if (likeRes.status === "fulfilled") likedSongIds.value = new Set(likeRes.value);
        if (albumRes.status === "fulfilled") albums.value = albumRes.value;
        if (artistRes.status === "fulfilled") artists.value = artistRes.value;
        if (levelRes.status === "fulfilled") level.value = levelRes.value;

        for (const r of settled) {
          if (r.status === "rejected") console.warn("[user] content load failed:", r.reason);
        }
        lastFetchedAt.value = Date.now();
      } finally {
        contentLoading.value = false;
      }
    };

    /** 切换红心，乐观更新，失败回滚 */
    const toggleLike = async (trackId: string): Promise<boolean> => {
      const wasLiked = likedSongIds.value.has(trackId);
      const next = new Set(likedSongIds.value);
      if (wasLiked) next.delete(trackId);
      else next.add(trackId);
      likedSongIds.value = next;
      try {
        const ok = await toggleLikeSong(trackId, !wasLiked);
        if (!ok) throw new Error("like api returned non-200");
        return true;
      } catch (err) {
        const rollback = new Set(likedSongIds.value);
        if (wasLiked) rollback.add(trackId);
        else rollback.delete(trackId);
        likedSongIds.value = rollback;
        console.warn("[user] toggle like failed:", err);
        return false;
      }
    };

    /** uid 变更 → 拉取/清空用户内容 */
    const syncContent = (uid: number | undefined): void => {
      if (uid) void loadContent(uid);
      else clearContent();
    };

    /** 用给定 profile 填充登录态 */
    const setProfile = (newProfile: UserProfile | null): void => {
      profile.value = newProfile;
      lastRefreshAt.value = newProfile ? Date.now() : 0;
      syncContent(newProfile?.userId);
    };

    /** 后台续期 cookie，失败静默 */
    const refresh = async (): Promise<void> => {
      try {
        await refreshLoginApi();
        lastRefreshAt.value = Date.now();
      } catch {}
    };

    /** 校验 cookie 并同步最新 profile + 用户内容 */
    const fetchStatus = async (): Promise<boolean> => {
      try {
        const latest = await fetchLoginStatus();
        if (latest) {
          profile.value = latest;
          syncContent(latest.userId);
          if (Date.now() - lastRefreshAt.value > REFRESH_INTERVAL_MS) {
            void refresh();
          }
          return true;
        }
        profile.value = null;
        lastRefreshAt.value = 0;
        syncContent(undefined);
        return false;
      } catch {
        // 网络失败保留缓存的 profile，不强制登出（离线可用性）
        return profile.value !== null;
      }
    };

    /** 登出：服务端清会话 + 主进程清 cookie + 本地清 profile 与内容 */
    const logout = async (): Promise<void> => {
      try {
        await logoutNetease();
      } catch {
        /* 服务端登出失败仍要清本地 */
      }
      await clearNeteaseSession();
      profile.value = null;
      lastRefreshAt.value = 0;
      syncContent(undefined);
    };

    return {
      profile,
      lastRefreshAt,
      isLoggedIn,
      setProfile,
      fetchStatus,
      logout,

      playlists,
      likedSongIds,
      albums,
      artists,
      level,
      subcount,
      lastFetchedAt,
      contentLoading,
      likedPlaylistId,
      createdPlaylists,
      subscribedPlaylists,
      isLiked,
      loadContent,
      toggleLike,
      clearContent,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: ["profile", "lastRefreshAt", "level"],
    },
  },
);
