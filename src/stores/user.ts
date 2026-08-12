import localforage from "localforage";
import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type { UserProfile, UserSubcount } from "@/types/user";
import { clearNeteaseSession, NeteaseApiError, onNeteaseAuthFailure } from "@/apis/netease";
import { isExplicitNeteaseAuthFailure } from "@/apis/neteaseAuth";
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
import {
  fetchPlaylist,
  createPlaylist as apiCreatePlaylist,
  deletePlaylist as apiDeletePlaylist,
  updatePlaylistName,
  updatePlaylistDesc,
  addToPlaylist,
  removeFromPlaylist,
  subscribePlaylist,
} from "@/apis/playlist/netease";
import { subscribeAlbum } from "@/apis/album/netease";
import { subscribeArtist } from "@/apis/artist/netease";
import { fetchUserCloud, deleteCloudSongs } from "@/apis/cloud/netease";

/** 登录 cookie 保活间隔 */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 「我喜欢的音乐」歌单曲目 */
const LIKED_PLAYLIST_CACHE_KEY = "liked-playlist";
/** 用户红心 id 列表 */
const LIKED_SONG_IDS_CACHE_KEY = "liked-song-ids";
/** 用户歌单元数据列表 */
const PLAYLISTS_CACHE_KEY = "playlists";
/** 云盘曲目缓存 */
const CLOUD_CACHE_KEY = "cloud-tracks";

interface LikedPlaylistCache {
  playlistId: string;
  tracks: Track[];
  cachedAt: number;
}

interface LikedSongIdsCache {
  userId: number;
  ids: string[];
  cachedAt: number;
}

interface PlaylistsCache {
  userId: number;
  playlists: Playlist[];
  cachedAt: number;
}

interface CloudCache {
  userId: number;
  tracks: Track[];
  count: number;
  size: number;
  maxSize: number;
  cachedAt: number;
}

const cacheDb = localforage.createInstance({ name: "splayer", storeName: "user-cache" });

const EMPTY_SUBCOUNT: UserSubcount = {
  createdPlaylistCount: 0,
  subPlaylistCount: 0,
  artistCount: 0,
};

export const useUserStore = defineStore(
  "user",
  () => {
    /** 用户基础资料 */
    const profile = ref<UserProfile | null>(null);
    /** 上一次 login_refresh 时间戳（毫秒） */
    const lastRefreshAt = ref<number>(0);
    /** 上一次尝试刷新时间戳（毫秒） */
    let lastRefreshAttemptAt = 0;
    let statusRequestId = 0;
    let invalidationPromise: Promise<void> | null = null;
    /** 是否已登录 */
    const isLoggedIn = computed(() => profile.value !== null);
    /** 全部歌单 */
    const playlists = shallowRef<Playlist[]>([]);
    /** 红心歌曲 id 集合 */
    const likedSongIds = shallowRef<Set<string>>(new Set());
    /** 收藏专辑 */
    const albums = shallowRef<Album[]>([]);
    /** 收藏歌手 */
    const artists = shallowRef<Artist[]>([]);
    /** 用户等级 */
    const level = ref<number | undefined>(undefined);
    /** 订阅计数 */
    const subcount = ref<UserSubcount>(EMPTY_SUBCOUNT);
    /** 「我喜欢的音乐」歌单 */
    const likedPlaylistTracks = shallowRef<Track[]>([]);
    /** 是否在拉取歌单曲目 */
    const likedPlaylistLoading = ref(false);
    /** 当前 tracks 关联的 playlistId */
    let currentLikedPlaylistId: string | null = null;
    /** 进行中的拉取 */
    let likedPlaylistAbort: AbortController | null = null;

    /** 云盘曲目 */
    const cloudTracks = shallowRef<Track[]>([]);
    /** 云盘曲目总数（服务端返回，可能 > tracks.length 在拉取过程中） */
    const cloudCount = ref(0);
    /** 已用容量（字节） */
    const cloudSize = ref(0);
    /** 总容量（字节） */
    const cloudMaxSize = ref(0);
    /** 是否在拉取云盘 */
    const cloudLoading = ref(false);
    /** 进行中的云盘拉取 */
    let cloudAbort: AbortController | null = null;

    /** 「我喜欢的音乐」歌单 id */
    const likedPlaylistId = computed<string | null>(() => playlists.value[0]?.id ?? null);

    /** 自建歌单 */
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

    /** 持久化红心 id 列表 */
    const persistLikedSongIds = (): void => {
      const userId = profile.value?.userId;
      if (!userId) return;
      const payload: LikedSongIdsCache = {
        userId,
        ids: [...likedSongIds.value],
        cachedAt: Date.now(),
      };
      cacheDb.setItem(LIKED_SONG_IDS_CACHE_KEY, payload).catch(() => {});
    };

    /**
     * 两组红心 id 是否一致
     * @param ids 歌曲 id 列表
     */
    const hasSameLikedSongIds = (ids: Iterable<string>): boolean => {
      const next = new Set(ids);
      if (next.size !== likedSongIds.value.size) return false;
      for (const id of next) {
        if (!likedSongIds.value.has(id)) return false;
      }
      return true;
    };

    /**
     * 应用远端红心 id 列表
     * @param ids 歌曲 id 列表
     */
    const applyLikedSongIds = (ids: Iterable<string>): void => {
      const next = [...ids];
      if (hasSameLikedSongIds(next)) return;
      likedSongIds.value = new Set(next);
      persistLikedSongIds();
    };

    /** 当前已加载的喜欢歌单是否与红心 id 集合一致 */
    const isLikedPlaylistFresh = (): boolean =>
      hasSameLikedSongIds(likedPlaylistTracks.value.map((track) => track.id));

    /** 清空所有用户内容 */
    const clearContent = (): void => {
      playlists.value = [];
      likedSongIds.value = new Set();
      albums.value = [];
      artists.value = [];
      level.value = undefined;
      subcount.value = EMPTY_SUBCOUNT;
      likedPlaylistAbort?.abort();
      likedPlaylistTracks.value = [];
      likedPlaylistLoading.value = false;
      currentLikedPlaylistId = null;
      cloudAbort?.abort();
      cloudTracks.value = [];
      cloudCount.value = 0;
      cloudSize.value = 0;
      cloudMaxSize.value = 0;
      cloudLoading.value = false;
    };

    /** 清除渲染端账号状态 */
    const resetAccountState = (): void => {
      profile.value = null;
      lastRefreshAt.value = 0;
      lastRefreshAttemptAt = 0;
      clearContent();
    };

    /** 清除失效凭据并切换到游客会话 */
    const invalidateSession = async (): Promise<void> => {
      statusRequestId += 1;
      resetAccountState();
      if (invalidationPromise) return invalidationPromise;
      invalidationPromise = clearNeteaseSession()
        .catch((err) => {
          console.warn("[user] clear expired netease session failed:", err);
        })
        .finally(() => {
          invalidationPromise = null;
        });
      return invalidationPromise;
    };

    /** 从缓存填充喜欢歌单 */
    const hydrateLikedPlaylistFromCache = async (playlistId: string): Promise<void> => {
      try {
        const cached = await cacheDb.getItem<LikedPlaylistCache>(LIKED_PLAYLIST_CACHE_KEY);
        if (cached && cached.playlistId === playlistId) likedPlaylistTracks.value = cached.tracks;
      } catch {
        console.error("[user] hydrate liked playlist from cache failed");
      }
    };

    /**
     * 持久化喜欢歌单曲目缓存
     * @param playlistId 歌单 id
     * @param tracks 歌单曲目
     */
    const persistLikedPlaylistCache = (playlistId: string, tracks: Track[]): void => {
      const payload: LikedPlaylistCache = {
        playlistId,
        tracks: tracks.map((track) => ({ ...track })),
        cachedAt: Date.now(),
      };
      cacheDb.setItem(LIKED_PLAYLIST_CACHE_KEY, payload).catch(() => {});
    };

    /** 拉取最新喜欢歌单曲目 */
    const refreshLikedPlaylist = async (playlistId: string): Promise<void> => {
      likedPlaylistAbort?.abort();
      const controller = new AbortController();
      likedPlaylistAbort = controller;
      if (likedPlaylistTracks.value.length === 0) likedPlaylistLoading.value = true;
      try {
        const accumulated: Track[] = [];
        await fetchPlaylist(playlistId, {
          signal: controller.signal,
          onBatch: (batch) => {
            if (controller.signal.aborted) return;
            accumulated.push(...batch);
            likedPlaylistTracks.value = [...accumulated];
          },
        });
        if (controller.signal.aborted) return;
        likedPlaylistTracks.value = accumulated;
        applyLikedSongIds(accumulated.map((track) => track.id));
        persistLikedPlaylistCache(playlistId, accumulated);
      } finally {
        if (!controller.signal.aborted) likedPlaylistLoading.value = false;
      }
    };

    /**
     * 确保「我喜欢的音乐」曲目已就绪
     * - 首次访问该歌单：缓存即时上屏 + 网络刷新
     * - 再次访问：likedSongIds 与已加载曲目内容不一致时刷新（外部增删过 → 数据脏）
     * @param force true 强制走网络刷新（用户手动点刷新时用）
     */
    const ensureLikedPlaylist = async (force = false): Promise<void> => {
      const playlistId = likedPlaylistId.value;
      if (!playlistId) return;
      if (currentLikedPlaylistId !== playlistId) {
        currentLikedPlaylistId = playlistId;
        likedPlaylistTracks.value = [];
        await hydrateLikedPlaylistFromCache(playlistId);
        refreshLikedPlaylist(playlistId);
        return;
      }
      if (force || !isLikedPlaylistFresh()) {
        refreshLikedPlaylist(playlistId);
      }
    };

    /** 恢复云盘缓存 */
    const hydrateCloudFromCache = async (userId: number): Promise<void> => {
      try {
        const cached = await cacheDb.getItem<CloudCache>(CLOUD_CACHE_KEY);
        if (!cached || cached.userId !== userId || cached.tracks.length === 0) return;
        cloudTracks.value = cached.tracks;
        cloudCount.value = cached.count;
        cloudSize.value = cached.size;
        cloudMaxSize.value = cached.maxSize;
      } catch {
        console.error("[user] hydrate cloud from cache failed");
      }
    };

    /** 把当前云盘状态写回 */
    const persistCloudCache = (): void => {
      const userId = profile.value?.userId;
      if (!userId) return;
      const payload: CloudCache = {
        userId,
        tracks: cloudTracks.value.map((track) => ({ ...track })),
        count: cloudCount.value,
        size: cloudSize.value,
        maxSize: cloudMaxSize.value,
        cachedAt: Date.now(),
      };
      cacheDb.setItem(CLOUD_CACHE_KEY, payload).catch(() => {});
    };

    /** 分页获取云盘全部曲目 */
    const refreshCloud = async (): Promise<void> => {
      cloudAbort?.abort();
      const controller = new AbortController();
      cloudAbort = controller;
      if (cloudTracks.value.length === 0) cloudLoading.value = true;
      try {
        const accumulated: Track[] = [];
        let offset = 0;
        const limit = 500;
        while (true) {
          if (controller.signal.aborted) return;
          const page = await fetchUserCloud(offset, limit);
          if (controller.signal.aborted) return;
          cloudCount.value = page.count;
          cloudSize.value = page.size;
          cloudMaxSize.value = page.maxSize;
          accumulated.push(...page.tracks);
          cloudTracks.value = [...accumulated];
          if (!page.hasMore || page.tracks.length < limit) break;
          offset += page.tracks.length;
        }
        if (!controller.signal.aborted) persistCloudCache();
      } catch (err) {
        console.warn("[user] cloud load failed:", err);
      } finally {
        if (!controller.signal.aborted) cloudLoading.value = false;
      }
    };

    /**
     * 确保云盘曲目已就绪
     * @param force true 时无论是否有缓存都重新拉取
     */
    const ensureCloud = async (force = false): Promise<void> => {
      const userId = profile.value?.userId;
      if (!userId) return;
      if (!force && cloudTracks.value.length > 0) return;
      if (cloudTracks.value.length === 0) await hydrateCloudFromCache(userId);
      await refreshCloud();
    };

    /**
     * 从云盘删除歌曲
     * @param trackIds 曲目 id 列表
     */
    const removeCloudTracks = async (trackIds: string[]): Promise<void> => {
      if (trackIds.length === 0) return;
      await deleteCloudSongs(trackIds);
      const removeSet = new Set(trackIds);
      cloudTracks.value = cloudTracks.value.filter((track) => !removeSet.has(track.id));
      cloudCount.value = Math.max(0, cloudCount.value - trackIds.length);
      persistCloudCache();
    };

    /** 从缓存恢复轻量内容 */
    const hydrateContentFromCache = async (userId: number): Promise<void> => {
      try {
        const [cachedIds, cachedPlaylists] = await Promise.all([
          cacheDb.getItem<LikedSongIdsCache>(LIKED_SONG_IDS_CACHE_KEY),
          cacheDb.getItem<PlaylistsCache>(PLAYLISTS_CACHE_KEY),
        ]);
        if (cachedIds?.userId === userId) {
          likedSongIds.value = new Set(cachedIds.ids);
        }
        if (cachedPlaylists?.userId === userId) {
          playlists.value = cachedPlaylists.playlists;
        }
      } catch {
        console.error("[user] hydrate content from cache failed");
      }
    };

    /**
     * 拉取并应用用户歌单
     * @param uid 用户 ID
     */
    const fetchAndApplyPlaylists = async (uid: number): Promise<void> => {
      const sub = await fetchSubcount();
      subcount.value = sub;
      const total = (sub.createdPlaylistCount || 0) + (sub.subPlaylistCount || 0) || 50;
      const list = await fetchUserPlaylists(uid, total);
      playlists.value = list;
      const payload: PlaylistsCache = {
        userId: uid,
        playlists: list,
        cachedAt: Date.now(),
      };
      cacheDb.setItem(PLAYLISTS_CACHE_KEY, payload).catch(() => {});
    };

    /**
     * 全量拉取用户内容
     * 并行发起，失败的子任务不会阻塞其他类目
     */
    const loadContent = async (uid: number): Promise<void> => {
      if (!uid) return;
      // 缓存即时上屏，不阻塞后续网络
      await hydrateContentFromCache(uid);
      const settled = await Promise.allSettled([
        fetchAndApplyPlaylists(uid),
        fetchLikelist(uid),
        fetchUserAlbums(),
        fetchUserArtists(),
        fetchUserLevel(),
      ]);
      const [_plRes, likeRes, albumRes, artistRes, levelRes] = settled;
      if (likeRes.status === "fulfilled") {
        applyLikedSongIds(likeRes.value);
      }
      if (albumRes.status === "fulfilled") albums.value = albumRes.value;
      if (artistRes.status === "fulfilled") artists.value = artistRes.value;
      if (levelRes.status === "fulfilled") level.value = levelRes.value;
      for (const result of settled) {
        if (result.status === "rejected") {
          console.warn("[user] content load failed:", result.reason);
        }
      }
      const playlistId = likedPlaylistId.value;
      if (playlistId && currentLikedPlaylistId === playlistId && !isLikedPlaylistFresh()) {
        refreshLikedPlaylist(playlistId);
      }
    };

    /**
     * 切换红心状态
     * @param trackId - 曲目全局 id
     */
    const toggleLike = async (trackId: string): Promise<boolean> => {
      const wasLiked = likedSongIds.value.has(trackId);
      const next = new Set(likedSongIds.value);
      if (wasLiked) next.delete(trackId);
      else next.add(trackId);
      likedSongIds.value = next;
      try {
        await toggleLikeSong(trackId, !wasLiked);
        persistLikedSongIds();
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

    /** 重新获取歌单列表 */
    const refreshPlaylists = async (): Promise<void> => {
      const uid = profile.value?.userId;
      if (!uid) return;
      try {
        await fetchAndApplyPlaylists(uid);
      } catch (err) {
        console.warn("[user] refreshPlaylists failed:", err);
      }
    };

    /**
     * 新建歌单
     * @param name 歌单名称
     * @param privacy 歌单隐私设置，0 为公开，10 为私密
     */
    const createPlaylist = async (name: string, privacy: 0 | 10 = 0): Promise<Playlist> => {
      const created = await apiCreatePlaylist(name, privacy);
      await refreshPlaylists();
      return created;
    };

    /**
     * 删除自建歌单
     * @param id 歌单 ID
     */
    const deletePlaylist = async (id: string): Promise<void> => {
      await apiDeletePlaylist(id);
      await refreshPlaylists();
    };

    /**
     * 改歌单名/描述
     * @param id 歌单 ID
     * @param data 包含要更新的名称和描述
     */
    const updatePlaylist = async (
      id: string,
      data: { name?: string; description?: string },
    ): Promise<void> => {
      const tasks: Promise<void>[] = [];
      if (typeof data.name === "string") tasks.push(updatePlaylistName(id, data.name));
      if (typeof data.description === "string")
        tasks.push(updatePlaylistDesc(id, data.description));
      if (tasks.length === 0) return;
      await Promise.all(tasks);
      await refreshPlaylists();
    };

    /**
     * 加歌到歌单
     * @param playlistId 歌单 ID
     * @param trackIds 曲目 ID 列表
     * @returns 成功添加的曲目数量
     */
    const addTracksToPlaylist = async (playlistId: string, trackIds: string[]): Promise<number> => {
      const count = await addToPlaylist(playlistId, trackIds);
      if (count <= 0) return 0;
      if (playlistId === likedPlaylistId.value) {
        const next = new Set(likedSongIds.value);
        for (const trackId of trackIds) next.add(trackId);
        likedSongIds.value = next;
        persistLikedSongIds();
      }
      await refreshPlaylists();
      return count;
    };

    /**
     * 从歌单移除曲目
     * @param playlistId 歌单 ID
     * @param trackIds 曲目 ID 列表
     */
    const removeTracksFromPlaylist = async (
      playlistId: string,
      trackIds: string[],
    ): Promise<void> => {
      await removeFromPlaylist(playlistId, trackIds);
      if (playlistId === likedPlaylistId.value) {
        const removeSet = new Set(trackIds);
        const next = new Set(likedSongIds.value);
        for (const trackId of trackIds) next.delete(trackId);
        likedSongIds.value = next;
        persistLikedSongIds();
        likedPlaylistTracks.value = likedPlaylistTracks.value.filter(
          (track) => !removeSet.has(track.id),
        );
      }
      await refreshPlaylists();
    };

    /** 订阅 / 取消订阅他人歌单 */
    const togglePlaylistSubscribe = async (
      playlistId: string,
      subscribe: boolean,
    ): Promise<void> => {
      await subscribePlaylist(playlistId, subscribe);
      await refreshPlaylists();
    };

    /** 收藏 / 取消收藏专辑 */
    const toggleAlbumSubscribe = async (albumId: string, subscribe: boolean): Promise<void> => {
      await subscribeAlbum(albumId, subscribe);
      albums.value = await fetchUserAlbums();
    };

    /** 收藏 / 取消收藏歌手 */
    const toggleArtistSubscribe = async (artistId: string, subscribe: boolean): Promise<void> => {
      await subscribeArtist(artistId, subscribe);
      artists.value = await fetchUserArtists();
    };

    /** 同步用户内容 */
    const syncContent = (uid: number | undefined): void => {
      if (uid) void loadContent(uid);
      else clearContent();
    };

    /** 续期 cookie */
    const refresh = async (): Promise<void> => {
      lastRefreshAttemptAt = Date.now();
      try {
        const renewed = await refreshLoginApi();
        if (renewed) lastRefreshAt.value = Date.now();
      } catch (err) {
        console.warn("[user] refresh netease session failed:", err);
      }
    };

    /** 校验 cookie 并同步最新 profile 与用户内容 */
    const fetchStatus = async (): Promise<boolean> => {
      const requestId = ++statusRequestId;
      try {
        const latest = await fetchLoginStatus();
        if (requestId !== statusRequestId) return profile.value !== null;
        if (latest) {
          const previousUserId = profile.value?.userId;
          profile.value = latest;
          if (previousUserId && previousUserId !== latest.userId) clearContent();
          syncContent(latest.userId);
          const lastRefresh = Math.max(lastRefreshAt.value, lastRefreshAttemptAt);
          if (Date.now() - lastRefresh > REFRESH_INTERVAL_MS) void refresh();
          return true;
        }
        await invalidateSession();
        return false;
      } catch (err) {
        if (requestId !== statusRequestId) return profile.value !== null;
        if (
          err instanceof NeteaseApiError &&
          isExplicitNeteaseAuthFailure({
            status: err.status,
            body: err.body,
            message: err.message,
          })
        ) {
          await invalidateSession();
          return false;
        }
        // 网络失败保留缓存的 profile，不强制登出（离线可用性）
        return profile.value !== null;
      }
    };

    onNeteaseAuthFailure(() => {
      void fetchStatus();
    });

    /** 登出 */
    const logout = async (): Promise<void> => {
      try {
        await logoutNetease();
      } catch {
        console.error("[user] logout failed");
      }
      await invalidateSession();
    };

    return {
      profile,
      lastRefreshAt,
      isLoggedIn,
      fetchStatus,
      invalidateSession,
      logout,

      playlists,
      likedSongIds,
      albums,
      artists,
      level,
      subcount,
      likedPlaylistId,
      likedPlaylistTracks,
      likedPlaylistLoading,
      createdPlaylists,
      subscribedPlaylists,
      isLiked,
      loadContent,
      toggleLike,
      ensureLikedPlaylist,
      clearContent,

      cloudTracks,
      cloudCount,
      cloudSize,
      cloudMaxSize,
      cloudLoading,
      ensureCloud,
      refreshCloud,
      removeCloudTracks,

      createPlaylist,
      deletePlaylist,
      updatePlaylist,
      addTracksToPlaylist,
      removeTracksFromPlaylist,
      togglePlaylistSubscribe,
      toggleAlbumSubscribe,
      toggleArtistSubscribe,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: ["profile", "lastRefreshAt", "level"],
    },
  },
);
