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
import { StreamingAuthError, classifyError } from "@/services/streaming/errors";

const NEEDS_AUTH: StreamingServerType[] = ["jellyfin", "emby"];
const needsAccessToken = (type: StreamingServerType): boolean => NEEDS_AUTH.includes(type);

/** 浏览缓存：每个 serverId 一个 cache 条目 */
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
  /** 是否正在拉数据（首次加载/刷新） */
  const loading = ref(false);
  /** 是否正在加载下一页歌曲（分页触底） */
  const loadingMoreSongs = ref(false);
  /** 歌曲列表是否还有下一页 */
  const hasMoreSongs = ref(true);
  /** 单页歌曲数量 */
  const SONGS_PAGE_SIZE = 100;

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
   * 局部更新服务器配置；改 url/username/password/type 会清空 token
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
    const list = [...servers.value];
    list[idx] = next;
    servers.value = list;
    persistServers();
  };

  /**
   * 移除服务器；若目标是当前激活的，连同激活 ID + IndexedDB 浏览缓存一并清空
   * @param id - 目标 server id
   */
  const removeServer = (id: string): void => {
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
   * 用临时 cfg 测试连接（不写 store）；jellyfin/emby 先 authenticate 再 ping
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
    if (id) patchServer(id, { accessToken: undefined, userId: undefined });
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
   * 拉取首页歌曲列表，覆盖现有缓存
   */
  const fetchSongs = async (): Promise<void> => {
    loading.value = true;
    hasMoreSongs.value = true;
    try {
      const result = await withActive((cfg) =>
        client.listSongs(cfg, { offset: 0, limit: SONGS_PAGE_SIZE }),
      );
      songs.value = result;
      hasMoreSongs.value = result.length >= SONGS_PAGE_SIZE;
      persistCache();
    } catch (err) {
      console.error("[streaming] fetchSongs failed:", err);
    } finally {
      loading.value = false;
    }
  };

  /**
   * 拉取下一页歌曲并追加到列表；无下一页或正在加载时直接返回
   */
  const fetchMoreSongs = async (): Promise<void> => {
    if (!hasMoreSongs.value || loadingMoreSongs.value || loading.value) return;
    loadingMoreSongs.value = true;
    try {
      const result = await withActive((cfg) =>
        client.listSongs(cfg, { offset: songs.value.length, limit: SONGS_PAGE_SIZE }),
      );
      songs.value = [...songs.value, ...result];
      hasMoreSongs.value = result.length >= SONGS_PAGE_SIZE;
      persistCache();
    } catch (err) {
      console.error("[streaming] fetchMoreSongs failed:", err);
    } finally {
      loadingMoreSongs.value = false;
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
   * Jellyfin/Emby PlaySessionId 跟随当前 Track：同一首歌反复要 URL 复用同一个
   * sessionId（重新连接、重试时不切会话），切到下一首才更新
   * Subsonic 不用 PlaySessionId，但保持同一签名简化 dispatcher
   */
  let lastPlaySession: { trackId: string; sessionId: string } | null = null;
  const getOrCreatePlaySessionId = (trackId: string): string => {
    if (lastPlaySession?.trackId === trackId) return lastPlaySession.sessionId;
    const sessionId = crypto.randomUUID();
    lastPlaySession = { trackId, sessionId };
    return sessionId;
  };

  /**
   * 取流播放 URL；未连接时尝试自动重连，失败抛错阻止播放
   * @param track - source="streaming" 的 Track（必须带 serverId/originalId）
   */
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
    const sessionId = getOrCreatePlaySessionId(track.id);
    return withAutoReauthFor(fresh, (c) => client.getStreamUrl(c, track.originalId!, sessionId));
  };

  /**
   * 取流媒体歌词；任意失败返回 null（不抛错，让 lyricLoader 走兜底链路）
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
   * 初始化：从主进程加载服务器列表（密码已解密），水合 IndexedDB 浏览缓存
   * 重复调用安全
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
    loadingMoreSongs,
    hasMoreSongs,
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
    fetchMoreSongs,
    fetchAlbumSongs,
    fetchPlaylistSongs,
    fetchArtistAlbums,
    search,
    // for player.ts / lyricLoader.ts
    getStreamUrl,
    getLyrics,
  };
});
