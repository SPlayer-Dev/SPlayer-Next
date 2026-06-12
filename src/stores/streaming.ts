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

  /** 落盘前剥离 cover/avatar URL 上的鉴权参数；落盘的不是可重放凭据 */
  const stripCacheAuth = (snapshot: ServerCache, type: StreamingServerType): ServerCache => ({
    songs: snapshot.songs.map((track) =>
      track.cover ? { ...track, cover: client.stripCoverAuth(track.cover, type) } : track,
    ),
    albums: snapshot.albums.map((album) =>
      album.cover ? { ...album, cover: client.stripCoverAuth(album.cover, type) } : album,
    ),
    artists: snapshot.artists.map((artist) =>
      artist.avatar ? { ...artist, avatar: client.stripCoverAuth(artist.avatar, type) } : artist,
    ),
    playlists: snapshot.playlists.map((playlist) =>
      playlist.cover
        ? { ...playlist, cover: client.stripCoverAuth(playlist.cover, type) }
        : playlist,
    ),
    updatedAt: snapshot.updatedAt,
  });

  /** 用当前 cfg 凭据为内存中的 cover/avatar URL 重新贴上鉴权 */
  const refreshCoverUrlsForActive = (): void => {
    const cfg = activeServer.value;
    if (!cfg) return;
    songs.value = songs.value.map((track) =>
      track.cover ? { ...track, cover: client.refreshCoverAuth(track.cover, cfg) } : track,
    );
    albums.value = albums.value.map((album) =>
      album.cover ? { ...album, cover: client.refreshCoverAuth(album.cover, cfg) } : album,
    );
    artists.value = artists.value.map((artist) =>
      artist.avatar ? { ...artist, avatar: client.refreshCoverAuth(artist.avatar, cfg) } : artist,
    );
    playlists.value = playlists.value.map((playlist) =>
      playlist.cover
        ? { ...playlist, cover: client.refreshCoverAuth(playlist.cover, cfg) }
        : playlist,
    );
  };

  const persistCache = (): void => {
    const key = currentCacheKey();
    const cfg = activeServer.value;
    if (!key || !cfg) return;
    const snapshot = stripCacheAuth(
      {
        songs: toRaw(songs.value),
        albums: toRaw(albums.value),
        artists: toRaw(artists.value),
        playlists: toRaw(playlists.value),
        updatedAt: Date.now(),
      },
      cfg.type,
    );
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
      // Subsonic 此时已有密码，覆盖鉴权立即生效；Jellyfin/Emby 缺 token 则仅剥离，
      // 待 connectToServer 成功再贴一次（防御性：旧版本可能落盘了带 api_key 的 URL）
      refreshCoverUrlsForActive();
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
   * @param id - 目标 server id
   */
  const removeServer = (id: string): void => {
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

  /** runConnect 返回值；ok=false 时把具体错误透传给调用方 */
  type ConnectResult = { ok: true } | { ok: false; error: string; code: StreamingErrorCode };

  /**
   * 连接/重登的内部实现
   * @param id - 目标 server id
   * @param isActive - 写 connectionStatus 时再求值；避免长 await 期间用户切了 server，把旧结果写到当前激活态上
   */
  const runConnect = async (id: string, isActive: () => boolean): Promise<ConnectResult> => {
    const cfg = servers.value.find((s) => s.id === id);
    if (!cfg) return { ok: false, error: "找不到服务器配置", code: "unknown" };
    const writeStatus = (next: typeof connectionStatus.value): void => {
      if (isActive()) connectionStatus.value = next;
    };
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
        const code = ping.code ?? "unknown";
        const error = ping.error ?? "ping 失败";
        writeStatus({ connected: false, error, errorCode: code });
        return { ok: false, error, code };
      }
      updates.lastConnected = Date.now();
      patchServer(id, updates);
      writeStatus({ connected: true });
      if (id === activeServerId.value) refreshCoverUrlsForActive();
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const code = classifyError(err);
      writeStatus({ connected: false, error, errorCode: code });
      return { ok: false, error, code };
    }
  };

  /**
   * 连接到指定服务器；jellyfin/emby 自动登录拿 token，subsonic 系仅 ping
   * token 和 lastConnected 合并一次落盘
   * @param id - 目标 server id
   */
  const connectToServer = async (id: string): Promise<boolean> => {
    const r = await runConnect(id, () => id === activeServerId.value);
    return r.ok;
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
      patchServer(id, { accessToken: undefined, userId: undefined });
    }
    connectionStatus.value = { connected: false };
  };

  /**
   * 包装：执行 fn；遇到 StreamingAuthError 自动重登重试一次
   * 仅 jellyfin/emby 走重登；subsonic 系密码错就是错，没有 token 概念
   *
   * 重登只在重登目标 === 当前激活服务器时写全局 connectionStatus，
   * 否则（队列里混入其它 server 的 Track）只静默更新 token，不污染激活态
   */
  const withAutoReauthFor = async <T>(
    cfg: StreamingServerConfig,
    fn: (cfg: StreamingServerConfig) => Promise<T>,
  ): Promise<T> => {
    try {
      return await fn(cfg);
    } catch (err) {
      if (!(err instanceof StreamingAuthError) || !needsAccessToken(cfg.type)) throw err;
      const r = await runConnect(cfg.id, () => cfg.id === activeServerId.value);
      if (!r.ok) throw err;
      const refreshed = servers.value.find((s) => s.id === cfg.id);
      if (!refreshed) throw err;
      return fn(refreshed);
    }
  };

  const withActive = <T>(fn: (cfg: StreamingServerConfig) => Promise<T>): Promise<T> =>
    withAutoReauthFor(requireActiveCfg(), fn);

  /**
   * 拉一次列表并写入对应运行时缓存；带 loading 与失败日志
   * fetchSongs 不走这里（它有分批 + seq 竞态）
   */
  const runListFetch = async <T>(
    fetch: (cfg: StreamingServerConfig) => Promise<T[]>,
    target: ShallowRef<T[]>,
    label: string,
  ): Promise<void> => {
    loading.value = true;
    try {
      target.value = await withActive(fetch);
      persistCache();
    } catch (err) {
      console.error(`[streaming] ${label} failed:`, err);
    } finally {
      loading.value = false;
    }
  };

  /**
   * 拉取专辑列表并写入运行时缓存
   * @param params - 可选分页参数（offset/limit）
   */
  const fetchAlbums = (params?: StreamingListParams): Promise<void> =>
    runListFetch((cfg) => client.listAlbums(cfg, params), albums, "fetchAlbums");

  /** 拉取歌手列表并写入运行时缓存 */
  const fetchArtists = (): Promise<void> =>
    runListFetch((cfg) => client.listArtists(cfg), artists, "fetchArtists");

  /** 拉取歌单列表并写入运行时缓存 */
  const fetchPlaylists = (): Promise<void> =>
    runListFetch((cfg) => client.listPlaylists(cfg), playlists, "fetchPlaylists");

  /** 防止刷新撞上后台分批 */
  let songsFetchSeq = 0;

  /** 拉取所有歌曲，覆盖现有缓存 */
  const fetchSongs = async (): Promise<void> => {
    const serverId = activeServerId.value;
    const seq = ++songsFetchSeq;
    loading.value = true;
    try {
      const first = await withActive((cfg) =>
        client.listSongs(cfg, { offset: 0, limit: SONGS_PAGE_SIZE }),
      );
      if (seq !== songsFetchSeq) return;
      songs.value = first;
      persistCache();
      if (first.length >= SONGS_PAGE_SIZE) {
        void fetchRemainingSongs(serverId, seq);
      }
    } catch (err) {
      console.error("[streaming] fetchSongs failed:", err);
    } finally {
      if (seq === songsFetchSeq) loading.value = false;
    }
  };

  /**
   * 后台递归拉剩余歌曲；服务器切换、断开或被新一轮 fetchSongs 覆盖时自动停止
   * @param serverId - 启动时绑定的 server id
   * @param seq - 启动时绑定的 songsFetchSeq
   */
  const fetchRemainingSongs = async (serverId: string | null, seq: number): Promise<void> => {
    // 每 4 批落盘一次而非每批：每次落盘都对四个完整数组克隆 + 序列化，逐批落
    // 是 O(n²) 写放大；完全不落则进程中途退出会丢掉本轮全部进度
    const PERSIST_EVERY_BATCHES = 4;
    let batchesSincePersist = 0;
    try {
      while (
        seq === songsFetchSeq &&
        activeServerId.value === serverId &&
        connectionStatus.value.connected &&
        songs.value.length % SONGS_PAGE_SIZE === 0
      ) {
        try {
          const offset = songs.value.length;
          const next = await withActive((cfg) =>
            client.listSongs(cfg, { offset, limit: SONGS_PAGE_SIZE }),
          );
          if (seq !== songsFetchSeq || activeServerId.value !== serverId) return;
          if (next.length === 0) return;
          songs.value = [...songs.value, ...next];
          if (next.length < SONGS_PAGE_SIZE) return;
          if (++batchesSincePersist >= PERSIST_EVERY_BATCHES) {
            batchesSincePersist = 0;
            persistCache();
          }
        } catch (err) {
          console.error("[streaming] fetchRemainingSongs failed:", err);
          return;
        }
      }
    } finally {
      if (seq === songsFetchSeq && activeServerId.value === serverId) persistCache();
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
   * 非激活服务器静默重连
   * @param track - source="streaming" 的 Track（必须带 serverId/originalId）
   * @param opts.playSessionId - 覆盖默认 PlaySessionId；用于背景缓存下载与播放流并发时区分会话
   */
  const getStreamUrl = async (track: Track, opts?: { playSessionId?: string }): Promise<string> => {
    const cfg = findCfgForTrack(track);
    const isActive = cfg.id === activeServerId.value;
    const needsConnect = isActive
      ? !connectionStatus.value.connected
      : needsAccessToken(cfg.type) && !cfg.accessToken;
    if (needsConnect) {
      const result = await runConnect(cfg.id, () => cfg.id === activeServerId.value);
      if (!result.ok) throw new Error(isActive ? result.error : `${cfg.name}: ${result.error}`);
    }
    const fresh = servers.value.find((s) => s.id === cfg.id) ?? cfg;
    const sessionId = opts?.playSessionId ?? session.sessionIdForTrack(track.id);
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
    } catch (err) {
      console.warn("[streaming] getLyrics failed:", err);
      return null;
    }
  };

  const init = async (): Promise<void> => {
    if (hydrated.value) return;
    const result = await window.api.streaming.loadServers();
    servers.value = result.servers;
    activeServerId.value = result.activeServerId;
    if (activeServerId.value && !servers.value.find((s) => s.id === activeServerId.value)) {
      activeServerId.value = null;
    }
    await hydrateFromCache();
    if (activeServerId.value) void connectToServer(activeServerId.value);
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
