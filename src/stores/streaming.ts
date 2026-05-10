import localforage from "localforage";
import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type {
  StreamingErrorCode,
  StreamingListParams,
  StreamingPingResult,
  StreamingSearchResult,
  StreamingServerConfig,
  StreamingServerInput,
  StreamingServerType,
} from "@shared/types/streaming";
import * as client from "@/services/streaming";
import * as session from "@/services/streaming/session";
import { StreamingAuthError, classifyError } from "@/services/streaming/errors";

const NEEDS_AUTH: StreamingServerType[] = ["jellyfin", "emby"];
const needsAccessToken = (type: StreamingServerType): boolean => NEEDS_AUTH.includes(type);

/** 浏览缓存 */
interface ServerCache {
  songs: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
  /** 最后更新时间 */
  updatedAt: number;
}

const cacheDb = localforage.createInstance({ name: "splayer", storeName: "streaming-cache" });
const cacheKey = (serverId: string): string => `cache:${serverId}`;

export const useStreamingStore = defineStore("streaming", () => {
  /** 服务器列表 */
  const servers = ref<StreamingServerConfig[]>([]);
  /** 当前激活服务器 ID */
  const activeServerId = ref<string | null>(null);
  /** 连接状态（仅运行时） */
  const connectionStatus = ref<{
    connected: boolean;
    error?: string;
    errorCode?: StreamingErrorCode;
  }>({ connected: false });
  /** 是否正在拉数据（首次加载/刷新；后台分批继续拉时仍为 false，UI 不再阻塞） */
  const loading = ref(false);
  /** 单页歌曲数量；首批返回后后台继续按此分批拉到拉完 */
  const SONGS_PAGE_SIZE = 500;

  /** 运行时缓存 */
  const songs = shallowRef<Track[]>([]);
  const albums = shallowRef<Album[]>([]);
  const artists = shallowRef<Artist[]>([]);
  const playlists = shallowRef<Playlist[]>([]);
  /** 缓存最后更新时间（ms） */
  const lastFetchedAt = ref(0);
  /** 是否已从 IndexedDB 完成首次水合 */
  const hydrated = ref(false);

  const activeServer = computed<StreamingServerConfig | null>(
    () => servers.value.find((s) => s.id === activeServerId.value) ?? null,
  );
  const hasServer = computed(() => servers.value.length > 0);
  const isConnected = computed(() => connectionStatus.value.connected);

  /** 把 servers + activeServerId 写到主进程 */
  const persistServers = (): void => {
    void window.api.streaming.saveServers({
      servers: servers.value.map((s) => ({ ...s })),
      activeServerId: activeServerId.value,
    });
  };

  const currentCacheKey = (): string | null =>
    activeServerId.value ? cacheKey(activeServerId.value) : null;

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

  const clearMemoryLists = (): void => {
    songs.value = [];
    albums.value = [];
    artists.value = [];
    playlists.value = [];
    lastFetchedAt.value = 0;
  };

  const hydrateFromCache = async (): Promise<void> => {
    const key = currentCacheKey();
    if (!key) {
      clearMemoryLists();
      hydrated.value = true;
      return;
    }
    const cached = await cacheDb.getItem<ServerCache>(key).catch(() => null);
    // 竞态保护：await 期间用户可能已切到其它服务器，丢弃过期结果
    if (key !== currentCacheKey()) return;
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

  const normalizeUrl = (url: string): string => url.trim().replace(/\/+$/, "");

  const requireActiveCfg = (): StreamingServerConfig => {
    const cfg = activeServer.value;
    if (!cfg) throw new Error("没有激活的流媒体服务器");
    return cfg;
  };

  /**
   * 把 patch 合并到指定 server 并落盘
   * @param id - 目标 server id
   * @param patch - 要合并的字段子集
   */
  const patchServer = (id: string, patch: Partial<StreamingServerConfig>): void => {
    const idx = servers.value.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const next = [...servers.value];
    next[idx] = { ...next[idx], ...patch };
    servers.value = next;
    persistServers();
  };

  /**
   * 新增服务器并落盘，返回带生成 id 的完整配置
   * @param input - 用户填的表单（name/type/url/username/password）
   */
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
    persistServers();
    return cfg;
  };

  /**
   * 局部更新服务器配置；改 url/username/password/type 会清空 token + 视图鉴权缓存
   * @param id - 目标 server id
   * @param patch - 表单字段子集
   */
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
    if (credentialsChanged) client.invalidateViewAuth(id);
    const list = [...servers.value];
    list[idx] = next;
    servers.value = list;
    persistServers();
  };

  /**
   * 移除服务器；若目标是当前激活的，连同激活 ID + IndexedDB 浏览缓存一并清空
   * Jellyfin/Emby 主动 logout 释放 server 端 session，Subsonic 视图鉴权缓存也清空
   * @param id - 目标 server id
   */
  const removeServer = (id: string): void => {
    const target = servers.value.find((s) => s.id === id);
    // 先 logout 再移除：要用到 accessToken
    if (target) void session.logout(target);
    client.invalidateViewAuth(id);
    servers.value = servers.value.filter((s) => s.id !== id);
    cacheDb.removeItem(cacheKey(id)).catch(() => {});
    if (activeServerId.value === id) {
      activeServerId.value = null;
      connectionStatus.value = { connected: false };
      clearMemoryLists();
    }
    persistServers();
  };

  /**
   * 用临时 cfg 测试连接
   * @param input - 用户填的表单
   */
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
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        code: classifyError(err),
      };
    }
  };

  /**
   * 连接到指定服务器；jellyfin/emby 自动登录拿 token，subsonic 系仅 ping
   * token 和 lastConnected 合并一次落盘
   * @param id - 目标 server id
   */
  const connectToServer = async (id: string): Promise<boolean> => {
    const cfg = servers.value.find((s) => s.id === id);
    if (!cfg) return false;
    try {
      const updates: Partial<StreamingServerConfig> = {};
      let probe = cfg;
      if (needsAccessToken(cfg.type)) {
        const auth = await client.authenticate(cfg);
        updates.accessToken = auth.accessToken;
        updates.userId = auth.userId;
        probe = { ...cfg, ...updates };
      }
      const ping = await client.ping(probe);
      if (!ping.ok) {
        connectionStatus.value = {
          connected: false,
          error: ping.error,
          errorCode: ping.code ?? "unknown",
        };
        return false;
      }
      updates.lastConnected = Date.now();
      patchServer(id, updates);
      connectionStatus.value = { connected: true };
      return true;
    } catch (err) {
      connectionStatus.value = {
        connected: false,
        error: err instanceof Error ? err.message : String(err),
        errorCode: classifyError(err),
      };
      return false;
    }
  };

  /**
   * 设为激活服务器并触发连接；id 与当前相同（断开状态重连）也会再走一遍
   * @param id - 目标 server id；传 null 则仅清空激活态
   */
  const setActiveServer = async (id: string | null): Promise<void> => {
    if (id !== activeServerId.value) {
      activeServerId.value = id;
      connectionStatus.value = { connected: false };
      hydrated.value = false;
      await hydrateFromCache();
      persistServers();
    }
    if (!id) return;
    await connectToServer(id);
  };

  /** 断开当前激活服务器（内存数据保留作为缓存显示，但 token 清空） */
  const disconnect = (): void => {
    const id = activeServerId.value;
    if (id) {
      const target = servers.value.find((s) => s.id === id);
      if (target) void session.logout(target);
      patchServer(id, { accessToken: undefined, userId: undefined });
    }
    connectionStatus.value = { connected: false };
  };

  /**
   * 包装：执行 fn；遇到 StreamingAuthError 自动重登重试一次
   * 仅 jellyfin/emby 走重登；subsonic 系密码错就是错，没有 token 概念
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

  const withActive = <T>(fn: (cfg: StreamingServerConfig) => Promise<T>): Promise<T> =>
    withAutoReauthFor(requireActiveCfg(), fn);

  /**
   * 拉取专辑列表并写入运行时缓存
   * @param params - 可选分页参数（offset/limit）
   */
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

  /** 拉取歌手列表并写入运行时缓存 */
  const fetchArtists = async (): Promise<void> => {
    loading.value = true;
    try {
      artists.value = await withActive((cfg) => client.listArtists(cfg));
      persistCache();
    } catch (err) {
      console.error("[streaming] fetchArtists failed:", err);
    } finally {
      loading.value = false;
    }
  };

  /** 拉取歌单列表并写入运行时缓存 */
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

  /**
   * 拉取所有歌曲，覆盖现有缓存
   *
   * 首批返回后立即解除 loading 让 UI 可用，剩余分批在后台递归继续拉到拉完
   * @param serverId - 触发时绑定的 server id；切换服务器后旧 loop 自动停
   */
  const fetchSongs = async (): Promise<void> => {
    const serverId = activeServerId.value;
    loading.value = true;
    try {
      const first = await withActive((cfg) =>
        client.listSongs(cfg, { offset: 0, limit: SONGS_PAGE_SIZE }),
      );
      songs.value = first;
      persistCache();
      if (first.length >= SONGS_PAGE_SIZE) {
        void fetchRemainingSongs(serverId);
      }
    } catch (err) {
      console.error("[streaming] fetchSongs failed:", err);
    } finally {
      loading.value = false;
    }
  };

  /**
   * 后台递归拉剩余歌曲；服务器切换或断开时自动停止
   * @param serverId - 启动时绑定的 server id
   */
  const fetchRemainingSongs = async (serverId: string | null): Promise<void> => {
    while (
      activeServerId.value === serverId &&
      connectionStatus.value.connected &&
      songs.value.length % SONGS_PAGE_SIZE === 0
    ) {
      try {
        const next = await withActive((cfg) =>
          client.listSongs(cfg, { offset: songs.value.length, limit: SONGS_PAGE_SIZE }),
        );
        if (activeServerId.value !== serverId) return;
        if (next.length === 0) return;
        songs.value = [...songs.value, ...next];
        persistCache();
        if (next.length < SONGS_PAGE_SIZE) return;
      } catch (err) {
        console.error("[streaming] fetchRemainingSongs failed:", err);
        return;
      }
    }
  };

  /**
   * 拉取指定专辑的歌曲
   * @param albumId - 专辑 originalId
   */
  const fetchAlbumSongs = (albumId: string): Promise<Track[]> =>
    withActive((cfg) => client.getAlbumSongs(cfg, albumId));

  /**
   * 拉取指定歌单的歌曲
   * @param playlistId - 歌单 originalId
   */
  const fetchPlaylistSongs = (playlistId: string): Promise<Track[]> =>
    withActive((cfg) => client.getPlaylistSongs(cfg, playlistId));

  /**
   * 拉取指定歌手名下的专辑
   * @param artistId - 歌手 originalId
   */
  const fetchArtistAlbums = (artistId: string): Promise<Album[]> =>
    withActive((cfg) => client.getArtistAlbums(cfg, artistId));

  /**
   * 拉取指定歌手名下的所有歌曲
   * @param artistId - 歌手 originalId
   */
  const fetchArtistSongs = (artistId: string): Promise<Track[]> =>
    withActive((cfg) => client.getArtistSongs(cfg, artistId));

  /**
   * 在激活服务器上搜索（歌曲/专辑/歌手聚合）
   * @param query - 搜索关键词
   */
  const search = (query: string): Promise<StreamingSearchResult> =>
    withActive((cfg) => client.search(cfg, query));

  /** Track.serverId 找 cfg；找不到抛错 */
  const findCfgForTrack = (track: Track): StreamingServerConfig => {
    if (track.source !== "streaming" || !track.serverId || !track.originalId) {
      throw new Error("非流媒体 Track");
    }
    const cfg = servers.value.find((s) => s.id === track.serverId);
    if (!cfg) throw new Error("找不到服务器配置");
    return cfg;
  };

  /**
   * 取流播放 URL
   * @param track - source="streaming" 的 Track（必须带 serverId/originalId）
   */
  const getStreamUrl = async (track: Track): Promise<string> => {
    const cfg = findCfgForTrack(track);
    const isActive = cfg.id === activeServerId.value;
    const needsConnect = isActive
      ? !connectionStatus.value.connected
      : needsAccessToken(cfg.type) && !cfg.accessToken;
    if (needsConnect) {
      const ok = await connectToServer(cfg.id);
      if (!ok) {
        throw new Error(
          isActive
            ? (connectionStatus.value.error ?? "未连接到流媒体服务器")
            : "无法连接到该曲所在的流媒体服务器",
        );
      }
    }
    const fresh = servers.value.find((s) => s.id === cfg.id) ?? cfg;
    const sessionId = session.sessionIdForTrack(track.id);
    return withAutoReauthFor(fresh, (c) => client.getStreamUrl(c, track.originalId!, sessionId));
  };

  /**
   * 取流媒体歌词
   * @param track - source="streaming" 的 Track
   */
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
   * 初始化：从主进程加载服务器列表
   */
  const init = async (): Promise<void> => {
    if (hydrated.value) return;
    const result = await window.api.streaming.loadServers();
    servers.value = result.servers;
    activeServerId.value = result.activeServerId;
    if (activeServerId.value && !servers.value.find((s) => s.id === activeServerId.value)) {
      activeServerId.value = null;
    }
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
    fetchArtistSongs,
    search,
    // for player.ts / lyricLoader.ts
    getStreamUrl,
    getLyrics,
  };
});
