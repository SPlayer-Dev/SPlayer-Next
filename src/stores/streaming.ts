import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type {
  StreamingErrorCode,
  StreamingPingResult,
  StreamingSearchResult,
  StreamingServerConfig,
  StreamingServerInput,
  StreamingFavoriteChange,
} from "@shared/types/streaming";
import { queue, removeServerTracks, updateQueueTracks } from "@/stores/queue";
import { useMediaStore } from "@/stores/media";

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
  /** 是否正在等待首个媒体库快照 */
  const loading = ref(false);
  const syncError = ref("");
  let favoriteRevision = 0;
  const favoriteOverrides = shallowRef(new Map<string, { favorite: boolean; revision: number }>());
  /** 只保留在途操作，收到同曲更新后作废旧响应，完成即释放 */
  const favoriteRequests = new Map<string, { changed: boolean; promise: Promise<boolean> }>();
  const togglingFavorites = new Map<string, { changed: boolean }>();

  /** 运行时缓存 */
  const songs = shallowRef<Track[]>([]);
  const albums = shallowRef<Album[]>([]);
  const artists = shallowRef<Artist[]>([]);
  const playlists = shallowRef<Playlist[]>([]);
  const indexedSongs = computed(() => new Map(songs.value.map((track) => [track.id, track])));
  let initialized = false;
  let initPromise: Promise<void> | undefined;
  const subscriptions: (() => void)[] = [];
  onScopeDispose(() => subscriptions.forEach((unsubscribe) => unsubscribe()));
  /** 防止服务器切换后旧请求覆盖当前列表 */
  let snapshotFetchSeq = 0;

  const activeServer = computed<StreamingServerConfig | null>(
    () => servers.value.find((s) => s.id === activeServerId.value) ?? null,
  );
  const hasServer = computed(() => servers.value.length > 0);
  const isConnected = computed(() => connectionStatus.value.connected);

  /** 清空当前服务器的内存列表 */
  const clearMemoryLists = (): void => {
    snapshotFetchSeq += 1;
    songs.value = [];
    albums.value = [];
    artists.value = [];
    playlists.value = [];
    loading.value = false;
    syncError.value = "";
    favoriteOverrides.value = new Map();
  };

  /**
   * 同步服务器收藏状态到列表、队列和当前曲目
   * @param change - 服务端确认的变更
   */
  const applyFavorite = (change: StreamingFavoriteChange): void => {
    const id = `${change.serverId}:${change.trackId}`;
    const read = favoriteRequests.get(id);
    const write = togglingFavorites.get(id);
    if (read) read.changed = true;
    if (write) write.changed = true;
    const overrides = new Map(favoriteOverrides.value);
    overrides.delete(id);
    overrides.set(id, { favorite: change.favorite, revision: ++favoriteRevision });
    while (overrides.size > 1024) overrides.delete(overrides.keys().next().value!);
    favoriteOverrides.value = overrides;
    songs.value = songs.value.map((track) =>
      track.id === id ? { ...track, favorite: change.favorite } : track,
    );
    const updates = queue.value
      .filter((track) => track.id === id)
      .map((track) => ({ ...track, favorite: change.favorite }));
    updateQueueTracks(updates);
    const media = useMediaStore();
    if (media.track?.id === id) media.setTrack({ ...media.track, favorite: change.favorite });
  };

  /**
   * 读取界面使用的收藏状态
   * @param track - 流媒体歌曲
   * @returns 最新收藏状态
   */
  const isFavorite = (track: Track): boolean => {
    const override = favoriteOverrides.value.get(track.id);
    if (override) return override.favorite;
    const indexed = indexedSongs.value.get(track.id);
    return indexed && (indexed.serverRevision ?? 0) === (track.serverRevision ?? 0)
      ? Boolean(indexed.favorite)
      : (track.favorite ?? false);
  };

  /**
   * 刷新单曲的服务端收藏状态，同曲并发读取共享一次请求
   * @param track - 流媒体歌曲
   * @returns 服务端状态
   */
  const refreshFavorite = (track: Track): Promise<boolean> => {
    if (!track.serverId || !track.originalId)
      return Promise.reject(new Error("流媒体歌曲缺少服务器身份"));
    const server = servers.value.find((item) => item.id === track.serverId);
    if (server && (server.mediaRevision ?? 0) !== (track.serverRevision ?? 0))
      return Promise.reject(new Error("流媒体账号或地址已更新，请重新选择歌曲"));
    const existing = favoriteRequests.get(track.id);
    if (existing) return existing.promise;
    const request: { changed: boolean; promise: Promise<boolean> } = {
      changed: false,
      promise: window.api.streaming
        .getFavorite(track.serverId, track.originalId)
        .then((favorite) => {
          if (!request.changed)
            applyFavorite({ serverId: track.serverId!, trackId: track.originalId!, favorite });
          return isFavorite(track);
        })
        .finally(() => favoriteRequests.delete(track.id)),
    };
    favoriteRequests.set(track.id, request);
    return request.promise;
  };

  /**
   * 以服务端最新状态切换收藏，避免持久化队列中的旧状态覆盖其他客户端操作
   * @param track - 流媒体歌曲
   * @returns 新状态，重复操作返回 null
   */
  const toggleFavorite = async (track: Track): Promise<boolean | null> => {
    if (togglingFavorites.has(track.id)) return null;
    const write = { changed: false };
    togglingFavorites.set(track.id, write);
    try {
      const previous = await refreshFavorite(track);
      write.changed = false;
      const favorite = await window.api.streaming.setFavorite(
        track.serverId!,
        track.originalId!,
        !previous,
      );
      if (!write.changed)
        applyFavorite({ serverId: track.serverId!, trackId: track.originalId!, favorite });
      return isFavorite(track);
    } finally {
      togglingFavorites.delete(track.id);
    }
  };

  /**
   * 新增服务器
   * @param input - 用户填的表单（name/type/url/username/password）
   * @returns 不包含凭据的服务器视图
   */
  const addServer = async (input: StreamingServerInput): Promise<StreamingServerConfig> => {
    const server = await window.api.streaming.addServer(toRaw(input));
    servers.value = [...servers.value, server];
    return server;
  };

  /**
   * 更新主进程保存的服务器配置
   * @param id - 目标 server id
   * @param input - 服务器表单
   * @returns 更新后的服务器视图
   */
  const updateServer = async (
    id: string,
    input: StreamingServerInput,
  ): Promise<StreamingServerConfig> => {
    const previous = servers.value.find((server) => server.id === id);
    const updated = await window.api.streaming.updateServer(id, toRaw(input));
    const idx = servers.value.findIndex((server) => server.id === id);
    if (idx < 0) return updated;
    const list = [...servers.value];
    list[idx] = updated;
    servers.value = list;
    if (
      previous?.url !== updated.url ||
      previous?.type !== updated.type ||
      previous?.username !== updated.username ||
      input.password
    )
      removeServerTracks(id);
    if (
      activeServerId.value === id &&
      (previous?.mediaRevision ?? 0) !== (updated.mediaRevision ?? 0)
    ) {
      connectionStatus.value = { connected: false };
      clearMemoryLists();
    }
    return updated;
  };

  /**
   * 移除服务器；若目标是当前激活的，同时清空界面状态
   * @param id - 目标 server id
   * @returns 删除完成
   */
  const removeServer = async (id: string): Promise<void> => {
    await window.api.streaming.removeServer(id);
    removeServerTracks(id);
    servers.value = servers.value.filter((s) => s.id !== id);
    if (activeServerId.value === id) {
      activeServerId.value = null;
      connectionStatus.value = { connected: false };
      clearMemoryLists();
    }
  };

  /**
   * 通过主进程测试服务器连接
   * @param input - 用户填的表单
   * @param serverId - 编辑中的服务器 ID
   * @returns 连通性结果
   */
  const testConnection = async (
    input: StreamingServerInput,
    serverId?: string,
  ): Promise<StreamingPingResult> => {
    return window.api.streaming.testConnection(toRaw(input), serverId);
  };

  /** runConnect 返回值；ok=false 时把具体错误透传给调用方 */
  type ConnectResult = { ok: true } | { ok: false; error: string; code: StreamingErrorCode };

  /**
   * 连接/重登的内部实现
   * @param id - 目标 server id
   * @param isActive - 写 connectionStatus 时再求值；避免长 await 期间用户切了 server，把旧结果写到当前激活态上
   * @returns 连接结果
   */
  const runConnect = async (id: string, isActive: () => boolean): Promise<ConnectResult> => {
    const cfg = servers.value.find((s) => s.id === id);
    if (!cfg) return { ok: false, error: "找不到服务器配置", code: "unknown" };
    /**
     * 只更新仍然激活的服务器状态
     * @param next - 本次连接的状态
     */
    const writeStatus = (next: typeof connectionStatus.value): void => {
      if (isActive()) connectionStatus.value = next;
    };
    try {
      const result = await window.api.streaming.connect(id);
      if (result.ok) {
        const index = servers.value.findIndex((server) => server.id === id);
        if (index >= 0) {
          const list = [...servers.value];
          list[index] = result.server;
          servers.value = list;
        }
        writeStatus({ connected: true });
        if (isActive()) await refreshLibrary(true);
        return { ok: true };
      }
      writeStatus({ connected: false, error: result.error, errorCode: result.code });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const code = "unknown" as const;
      writeStatus({ connected: false, error, errorCode: code });
      return { ok: false, error, code };
    }
  };

  /**
   * 连接到指定服务器
   * @param id - 目标 server id
   * @returns 是否连接成功
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
      clearMemoryLists();
      await window.api.streaming.setActiveServer(id);
    }
    if (!id) return;
    await connectToServer(id);
  };

  /** 断开当前激活服务器 */
  const disconnect = (): void => {
    const id = activeServerId.value;
    if (id) void window.api.streaming.disconnect(id);
    connectionStatus.value = { connected: false };
    loading.value = false;
  };

  /**
   * 从主进程读取媒体库快照
   * @param serverId - 服务器 ID
   */
  const loadLibrarySnapshot = async (serverId: string): Promise<void> => {
    const seq = ++snapshotFetchSeq;
    const revision = favoriteRevision;
    try {
      const snapshot = await window.api.streaming.getSnapshot(serverId);
      if (seq !== snapshotFetchSeq || activeServerId.value !== serverId) return;
      // 快照请求发出后确认的收藏优先于迟到的旧快照
      songs.value = snapshot.songs.map((track) => {
        const override = favoriteOverrides.value.get(track.id);
        return override && override.revision > revision
          ? { ...track, favorite: override.favorite }
          : track;
      });
      albums.value = snapshot.albums;
      artists.value = snapshot.artists;
      playlists.value = snapshot.playlists;
      const overrides = new Map(favoriteOverrides.value);
      for (const [key, override] of overrides)
        if (key.startsWith(`${serverId}:`) && override.revision <= revision) overrides.delete(key);
      favoriteOverrides.value = overrides;
      for (const [id, request] of favoriteRequests)
        if (id.startsWith(`${serverId}:`)) request.changed = true;
      for (const [id, request] of togglingFavorites)
        if (id.startsWith(`${serverId}:`)) request.changed = true;
      const byId = indexedSongs.value;
      updateQueueTracks(
        queue.value.flatMap((track) =>
          byId.has(track.id) ? [{ ...track, favorite: byId.get(track.id)!.favorite }] : [],
        ),
      );
      const media = useMediaStore();
      if (media.track && byId.has(media.track.id))
        media.setTrack({ ...media.track, favorite: byId.get(media.track.id)!.favorite });
    } catch (err) {
      console.error("[streaming] loadLibrarySnapshot failed:", err);
    }
  };

  /**
   * 显示本地快照并请求主进程后台刷新
   * @param force - 是否强制重新同步
   */
  const refreshLibrary = async (force = false): Promise<void> => {
    const serverId = activeServerId.value;
    if (!serverId) return;
    loading.value = true;
    try {
      await loadLibrarySnapshot(serverId);
      const started = await window.api.streaming.sync(serverId, force);
      if (!started && activeServerId.value === serverId) loading.value = false;
    } catch (err) {
      if (activeServerId.value === serverId) loading.value = false;
      console.error("[streaming] refreshLibrary failed:", err);
    }
  };

  /**
   * 拉取指定专辑的歌曲
   * @param albumId - 专辑 originalId
   * @param serverId - 所属服务器，旧路由默认使用当前服务器
   * @returns 专辑歌曲
   */
  const fetchAlbumSongs = (albumId: string, serverId = activeServerId.value): Promise<Track[]> =>
    serverId
      ? window.api.streaming.getAlbumSongs(serverId, albumId)
      : Promise.reject(new Error("没有激活的流媒体服务器"));

  /**
   * 拉取指定歌单的歌曲
   * @param playlistId - 歌单 originalId
   * @param serverId - 所属服务器，旧路由默认使用当前服务器
   * @returns 歌单歌曲
   */
  const fetchPlaylistSongs = (
    playlistId: string,
    serverId = activeServerId.value,
  ): Promise<Track[]> =>
    serverId
      ? window.api.streaming.getPlaylistSongs(serverId, playlistId)
      : Promise.reject(new Error("没有激活的流媒体服务器"));

  /**
   * 拉取指定歌手名下的专辑
   * @param artistId - 歌手 originalId
   * @param serverId - 所属服务器，旧路由默认使用当前服务器
   * @returns 歌手专辑
   */
  const fetchArtistAlbums = (
    artistId: string,
    serverId = activeServerId.value,
  ): Promise<Album[]> =>
    serverId
      ? window.api.streaming.getArtistAlbums(serverId, artistId)
      : Promise.reject(new Error("没有激活的流媒体服务器"));

  /**
   * 拉取指定歌手名下的所有歌曲
   * @param artistId - 歌手 originalId
   * @param serverId - 所属服务器，旧路由默认使用当前服务器
   * @returns 歌手歌曲
   */
  const fetchArtistSongs = (artistId: string, serverId = activeServerId.value): Promise<Track[]> =>
    serverId
      ? window.api.streaming.getArtistSongs(serverId, artistId)
      : Promise.reject(new Error("没有激活的流媒体服务器"));

  /**
   * 在激活服务器上搜索（歌曲/专辑/歌手聚合）
   * @param query - 搜索关键词
   * @returns 聚合搜索结果
   */
  const search = (query: string): Promise<StreamingSearchResult> =>
    activeServerId.value
      ? window.api.streaming.search(activeServerId.value, query)
      : Promise.reject(new Error("没有激活的流媒体服务器"));

  /** 初始化服务器配置和媒体库更新订阅 */
  const init = (): Promise<void> => {
    if (initialized) return Promise.resolve();
    if (initPromise) return initPromise;
    initPromise = (async () => {
      subscriptions.push(window.api.streaming.onFavoriteChanged(applyFavorite));
      subscriptions.push(
        window.api.streaming.onSyncState((status) => {
          if (status.serverId !== activeServerId.value) return;
          loading.value = status.state === "running";
          syncError.value = status.error ?? "";
        }),
      );
      subscriptions.push(
        window.api.streaming.onLibraryUpdated(async (serverId) => {
          if (serverId !== activeServerId.value) return;
          await loadLibrarySnapshot(serverId);
          if (serverId === activeServerId.value) loading.value = false;
        }),
      );
      const result = await window.api.streaming.loadServers();
      servers.value = result.servers;
      activeServerId.value = result.activeServerId;
      if (activeServerId.value && !servers.value.find((s) => s.id === activeServerId.value)) {
        activeServerId.value = null;
      }
      initialized = true;
      const media = useMediaStore();
      subscriptions.push(
        watch(
          () =>
            media.track?.source === "streaming"
              ? `${media.track.id}:${media.track.serverRevision ?? 0}`
              : null,
          () => {
            if (media.track?.source === "streaming")
              void refreshFavorite(media.track).catch(() => {});
          },
          { immediate: true },
        ),
      );
      if (activeServerId.value) void connectToServer(activeServerId.value);
    })().finally(() => {
      initPromise = undefined;
    });
    return initPromise;
  };

  return {
    servers,
    activeServerId,
    activeServer,
    connectionStatus,
    loading,
    syncError,
    hasServer,
    isConnected,
    songs,
    albums,
    artists,
    playlists,
    init,
    addServer,
    updateServer,
    removeServer,
    setActiveServer,
    connectToServer,
    disconnect,
    testConnection,
    refreshLibrary,
    fetchAlbumSongs,
    fetchPlaylistSongs,
    fetchArtistAlbums,
    fetchArtistSongs,
    search,
    isFavorite,
    refreshFavorite,
    toggleFavorite,
  };
});
