import localforage from "localforage";
import type { Track } from "@shared/types/player";
import type {
  StreamingAlbum,
  StreamingArtist,
  StreamingListParams,
  StreamingPingResult,
  StreamingPlaylist,
  StreamingSearchResult,
  StreamingServerConfig,
  StreamingServerInput,
  StreamingServerType,
} from "@shared/types/streaming";
import * as client from "@/services/streaming";
import { StreamingAuthError } from "@/services/streaming/errors";

const NEEDS_AUTH: StreamingServerType[] = ["jellyfin", "emby"];
const needsAccessToken = (type: StreamingServerType): boolean => NEEDS_AUTH.includes(type);

/** 浏览缓存：每个 serverId 一个 cache 条目 */
interface ServerCache {
  songs: Track[];
  albums: StreamingAlbum[];
  artists: StreamingArtist[];
  playlists: StreamingPlaylist[];
  /** 最后更新时间 */
  updatedAt: number;
}

const cacheDb = localforage.createInstance({ name: "splayer", storeName: "streaming-cache" });
const cacheKey = (serverId: string): string => `cache:${serverId}`;

export const useStreamingStore = defineStore(
  "streaming",
  () => {
    /** 服务器列表（明文持久化在 localStorage） */
    const servers = ref<StreamingServerConfig[]>([]);
    /** 当前激活服务器 ID */
    const activeServerId = ref<string | null>(null);
    /** 连接状态（仅运行时） */
    const connectionStatus = ref<{ connected: boolean; error?: string }>({ connected: false });
    /** 是否正在拉数据 */
    const loading = ref(false);

    /** 运行时缓存（启动从 IndexedDB 水合，浏览时回写） */
    const songs = shallowRef<Track[]>([]);
    const albums = shallowRef<StreamingAlbum[]>([]);
    const artists = shallowRef<StreamingArtist[]>([]);
    const playlists = shallowRef<StreamingPlaylist[]>([]);
    /** 缓存最后更新时间（ms），UI 可据此判断是否过期 */
    const lastFetchedAt = ref(0);
    /** 是否已从 IndexedDB 完成首次水合 */
    const hydrated = ref(false);

    const activeServer = computed<StreamingServerConfig | null>(
      () => servers.value.find((s) => s.id === activeServerId.value) ?? null,
    );
    const hasServer = computed(() => servers.value.length > 0);
    const isConnected = computed(() => connectionStatus.value.connected);

    /** 当前激活服务器的缓存键 */
    const currentCacheKey = (): string | null =>
      activeServerId.value ? cacheKey(activeServerId.value) : null;

    /** 把内存中的列表写回 IndexedDB（按当前激活服务器） */
    const persistCache = (): void => {
      const key = currentCacheKey();
      if (!key) return;
      const snapshot: ServerCache = {
        songs: toRaw(songs.value),
        albums: toRaw(albums.value),
        artists: toRaw(artists.value),
        playlists: toRaw(playlists.value),
        updatedAt: Date.now(),
      };
      lastFetchedAt.value = snapshot.updatedAt;
      cacheDb.setItem(key, snapshot).catch(() => {});
    };

    /** 从 IndexedDB 读出当前激活服务器的缓存到内存 */
    const hydrateFromCache = async (): Promise<void> => {
      const key = currentCacheKey();
      if (!key) {
        clearMemoryLists();
        hydrated.value = true;
        return;
      }
      const cached = await cacheDb.getItem<ServerCache>(key).catch(() => null);
      if (cached) {
        songs.value = cached.songs;
        albums.value = cached.albums;
        artists.value = cached.artists;
        playlists.value = cached.playlists;
        lastFetchedAt.value = cached.updatedAt;
      } else {
        clearMemoryLists();
      }
      hydrated.value = true;
    };

    /** 仅清内存数据，不动 IndexedDB（IndexedDB 在 removeServer 时清） */
    const clearMemoryLists = (): void => {
      songs.value = [];
      albums.value = [];
      artists.value = [];
      playlists.value = [];
      lastFetchedAt.value = 0;
    };

    const normalizeUrl = (url: string): string => url.trim().replace(/\/+$/, "");

    const requireActiveCfg = (): StreamingServerConfig => {
      const cfg = activeServer.value;
      if (!cfg) throw new Error("没有激活的流媒体服务器");
      return cfg;
    };

    /** 把 patch 应用到指定 server */
    const patchServer = (id: string, patch: Partial<StreamingServerConfig>): void => {
      const idx = servers.value.findIndex((s) => s.id === id);
      if (idx < 0) return;
      const next = [...servers.value];
      next[idx] = { ...next[idx], ...patch };
      servers.value = next;
    };

    /** 添加服务器 */
    const addServer = (input: StreamingServerInput): StreamingServerConfig => {
      const cfg: StreamingServerConfig = {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        type: input.type,
        url: normalizeUrl(input.url),
        username: input.username,
        password: input.password,
      };
      servers.value = [...servers.value, cfg];
      return cfg;
    };

    /** 局部更新；改 url/username/password/type 会清空 token */
    const updateServer = (id: string, patch: Partial<StreamingServerInput>): void => {
      const idx = servers.value.findIndex((s) => s.id === id);
      if (idx < 0) return;
      const old = servers.value[idx];
      const credentialsChanged =
        (patch.url !== undefined && normalizeUrl(patch.url) !== old.url) ||
        (patch.username !== undefined && patch.username !== old.username) ||
        (patch.password !== undefined && patch.password !== old.password) ||
        (patch.type !== undefined && patch.type !== old.type);
      const next: StreamingServerConfig = {
        ...old,
        name: patch.name?.trim() ?? old.name,
        type: patch.type ?? old.type,
        url: patch.url !== undefined ? normalizeUrl(patch.url) : old.url,
        username: patch.username ?? old.username,
        password: patch.password ?? old.password,
        accessToken: credentialsChanged ? undefined : old.accessToken,
        userId: credentialsChanged ? undefined : old.userId,
      };
      const list = [...servers.value];
      list[idx] = next;
      servers.value = list;
    };

    /** 移除服务器，激活 ID + IndexedDB 缓存一并清空 */
    const removeServer = (id: string): void => {
      servers.value = servers.value.filter((s) => s.id !== id);
      cacheDb.removeItem(cacheKey(id)).catch(() => {});
      if (activeServerId.value === id) {
        activeServerId.value = null;
        connectionStatus.value = { connected: false };
        clearMemoryLists();
      }
    };

    /** 测试连接（不写 store）。jellyfin/emby 先 authenticate 再 ping */
    const testConnection = async (input: StreamingServerInput): Promise<StreamingPingResult> => {
      const tempCfg: StreamingServerConfig = {
        id: "__test__",
        name: input.name,
        type: input.type,
        url: normalizeUrl(input.url),
        username: input.username,
        password: input.password,
      };
      try {
        if (needsAccessToken(input.type)) {
          const auth = await client.authenticate(tempCfg);
          tempCfg.accessToken = auth.accessToken;
          tempCfg.userId = auth.userId;
        }
        return await client.ping(tempCfg);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    };

    /**
     * 连接到指定服务器：jellyfin/emby 自动登录拿 token，subsonic 系仅 ping。
     */
    const connectToServer = async (id: string): Promise<boolean> => {
      const cfg = servers.value.find((s) => s.id === id);
      if (!cfg) return false;
      try {
        if (needsAccessToken(cfg.type)) {
          const auth = await client.authenticate(cfg);
          patchServer(id, { accessToken: auth.accessToken, userId: auth.userId });
        }
        const fresh = servers.value.find((s) => s.id === id)!;
        const ping = await client.ping(fresh);
        if (!ping.ok) {
          connectionStatus.value = { connected: false, error: ping.error };
          return false;
        }
        patchServer(id, { lastConnected: Date.now() });
        connectionStatus.value = { connected: true };
        return true;
      } catch (err) {
        connectionStatus.value = {
          connected: false,
          error: err instanceof Error ? err.message : String(err),
        };
        return false;
      }
    };

    /**
     * 设为激活服务器并触发连接。
     * 如果 id 和当前激活相同（用户在断开状态下重新点击连接），仍走重连流程。
     */
    const setActiveServer = async (id: string | null): Promise<void> => {
      if (id !== activeServerId.value) {
        activeServerId.value = id;
        connectionStatus.value = { connected: false };
        hydrated.value = false;
        await hydrateFromCache();
      }
      if (!id) return;
      await connectToServer(id);
    };

    /** 断开当前激活服务器（内存数据保留作为缓存显示，但 token 清空） */
    const disconnect = (): void => {
      const id = activeServerId.value;
      if (id) patchServer(id, { accessToken: undefined, userId: undefined });
      connectionStatus.value = { connected: false };
    };

    /**
     * 包装：执行 fn；遇到 StreamingAuthError 自动重登重试一次。
     * 仅 jellyfin/emby 走重登；subsonic 系密码错就是错，没有 token 概念。
     */
    const withAutoReauthFor = async <T>(
      cfg: StreamingServerConfig,
      fn: (cfg: StreamingServerConfig) => Promise<T>,
    ): Promise<T> => {
      try {
        return await fn(cfg);
      } catch (err) {
        if (!(err instanceof StreamingAuthError) || !needsAccessToken(cfg.type)) throw err;
        const ok = await connectToServer(cfg.id);
        if (!ok) throw err;
        const refreshed = servers.value.find((s) => s.id === cfg.id);
        if (!refreshed) throw err;
        return fn(refreshed);
      }
    };

    /** 用激活服务器执行 */
    const withActive = <T>(fn: (cfg: StreamingServerConfig) => Promise<T>): Promise<T> =>
      withAutoReauthFor(requireActiveCfg(), fn);

    /* ───────────── 浏览（写入运行时缓存） ───────────── */

    const fetchAlbums = async (params?: StreamingListParams): Promise<void> => {
      loading.value = true;
      try {
        albums.value = await withActive((cfg) => client.listAlbums(cfg, params));
        persistCache();
      } catch (err) {
        console.error("[streaming] fetchAlbums failed:", err);
      } finally {
        loading.value = false;
      }
    };

    const fetchArtists = async (): Promise<void> => {
      loading.value = true;
      try {
        const result = await withActive((cfg) => client.listArtists(cfg));
        console.debug(`[streaming] fetchArtists: got ${result.length} artists`);
        artists.value = result;
        persistCache();
      } catch (err) {
        console.error("[streaming] fetchArtists failed:", err);
      } finally {
        loading.value = false;
      }
    };

    const fetchPlaylists = async (): Promise<void> => {
      loading.value = true;
      try {
        playlists.value = await withActive((cfg) => client.listPlaylists(cfg));
        persistCache();
      } catch (err) {
        console.error("[streaming] fetchPlaylists failed:", err);
      } finally {
        loading.value = false;
      }
    };

    const fetchSongs = async (params?: StreamingListParams): Promise<void> => {
      loading.value = true;
      try {
        songs.value = await withActive((cfg) => client.listSongs(cfg, params));
        persistCache();
      } catch (err) {
        console.error("[streaming] fetchSongs failed:", err);
      } finally {
        loading.value = false;
      }
    };

    /* ───────────── 详情（不写入缓存） ───────────── */

    const fetchAlbumSongs = (albumId: string): Promise<Track[]> =>
      withActive((cfg) => client.getAlbumSongs(cfg, albumId));

    const fetchPlaylistSongs = (playlistId: string): Promise<Track[]> =>
      withActive((cfg) => client.getPlaylistSongs(cfg, playlistId));

    const fetchArtistAlbums = (artistId: string): Promise<StreamingAlbum[]> =>
      withActive((cfg) => client.getArtistAlbums(cfg, artistId));

    const search = (query: string): Promise<StreamingSearchResult> =>
      withActive((cfg) => client.search(cfg, query));

    /* ───────────── 给 player.ts / lyricLoader.ts 用 ───────────── */

    /** Track.serverId 找 cfg；找不到抛错 */
    const findCfgForTrack = (track: Track): StreamingServerConfig => {
      if (track.source !== "streaming" || !track.serverId || !track.originalId) {
        throw new Error("非流媒体 Track");
      }
      const cfg = servers.value.find((s) => s.id === track.serverId);
      if (!cfg) throw new Error("找不到服务器配置");
      return cfg;
    };

    const getStreamUrl = async (track: Track): Promise<string> => {
      const cfg = findCfgForTrack(track);
      // 未连接时尝试自动重连一次；仍失败则阻止播放
      // （subsonic 的 stream URL 不依赖 token，单靠 cfg 就能生成，
      //  必须在此处把关，否则脱机也能拼出 URL 让 audio-engine 去试）
      if (cfg.id === activeServerId.value && !connectionStatus.value.connected) {
        const ok = await connectToServer(cfg.id);
        if (!ok) {
          throw new Error(connectionStatus.value.error ?? "未连接到流媒体服务器");
        }
      }
      const fresh = servers.value.find((s) => s.id === cfg.id) ?? cfg;
      return withAutoReauthFor(fresh, (c) => client.getStreamUrl(c, track.originalId!));
    };

    const getLyrics = async (track: Track): Promise<string | null> => {
      try {
        const cfg = findCfgForTrack(track);
        return await withAutoReauthFor(cfg, (c) =>
          client.getLyrics(c, track.originalId!, {
            artist: track.artists?.[0]?.name,
            title: track.title,
          }),
        );
      } catch {
        return null;
      }
    };

    /**
     * 初始化：从 IndexedDB 水合当前激活服务器的缓存。
     * 应当在应用启动时（或 streaming 页面挂载时）调用一次。
     * 重复调用安全。
     */
    const init = async (): Promise<void> => {
      if (hydrated.value) return;
      await hydrateFromCache();
    };

    return {
      // state
      servers,
      activeServerId,
      activeServer,
      connectionStatus,
      loading,
      hasServer,
      isConnected,
      hydrated,
      lastFetchedAt,
      songs,
      albums,
      artists,
      playlists,
      // lifecycle
      init,
      // server management
      addServer,
      updateServer,
      removeServer,
      setActiveServer,
      connectToServer,
      disconnect,
      testConnection,
      // browse
      fetchAlbums,
      fetchArtists,
      fetchPlaylists,
      fetchSongs,
      fetchAlbumSongs,
      fetchPlaylistSongs,
      fetchArtistAlbums,
      search,
      // for player.ts / lyricLoader.ts
      getStreamUrl,
      getLyrics,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: ["servers", "activeServerId"],
    },
  },
);
