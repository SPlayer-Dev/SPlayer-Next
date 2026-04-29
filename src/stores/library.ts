import localforage from "localforage";
import type { Track, Artist } from "@shared/types/player";
import type { AlbumSummary, ArtistSummary, ScanProgress } from "@shared/types/library";
import type { Collection } from "@/types/collection";
import type { ArtistProfile, CoverItem } from "@/types/artist";
import { buildFolderTree, countFolders } from "@/utils/folderTree";

const trackDb = localforage.createInstance({ name: "splayer", storeName: "library" });

export const useLibraryStore = defineStore("library", () => {
  /** 曲目列表 */
  const tracks = shallowRef<Track[]>([]);
  /** 扫描目录列表 */
  const scanDirs = ref<string[]>([]);
  /** 是否正在扫描 */
  const scanning = ref(false);
  /** 扫描进度 */
  const scanProgress = ref<ScanProgress | null>(null);
  /** 是否已初始化 */
  const initialized = ref(false);
  /** 歌手头像缓存 */
  const artistAvatars = shallowRef<Record<string, string>>({});

  /** 标准化歌手名 */
  const normalizeArtistName = (name: string): string => name.trim().toLowerCase();

  /**
   * 获取歌手头像
   * @param artistName 歌手名
   */
  const getArtistAvatar = (artistName: string): string | undefined => {
    const key = normalizeArtistName(artistName);
    if (!key) return;
    return artistAvatars.value[key];
  };

  /**
   * 设置歌手头像
   * @param artistName 歌手名
   * @param avatar 歌手头像
   */
  const setArtistAvatar = (artistName: string, avatar: string): void => {
    const key = normalizeArtistName(artistName);
    if (!key || !avatar) return;
    if (artistAvatars.value[key] === avatar) return;
    artistAvatars.value = { ...artistAvatars.value, [key]: avatar };
  };

  /** 批量预取头像 */
  const loadArtistAvatars = async (): Promise<void> => {
    const list = await getArtistList();
    const names = list
      .filter((item) => !artistAvatars.value[normalizeArtistName(item.name)])
      .map((item) => item.name);
    if (!names.length) return;
    const res = await window.api.library.prefetchArtistAvatars(names);
    if (!res.success || !res.data) return;
    const patch: Record<string, string> = {};
    for (const [key, avatar] of Object.entries(res.data)) {
      if (avatar) patch[key] = avatar;
    }
    if (Object.keys(patch).length > 0) {
      artistAvatars.value = { ...artistAvatars.value, ...patch };
    }
  };

  /** 将曲目写入 IndexedDB 缓存 */
  const cacheTracks = (items: Track[]): void => {
    trackDb.setItem("tracks", toRaw(items)).catch(() => {});
  };

  /** 加载曲目和目录列表 */
  const load = async (): Promise<void> => {
    // 先从 IndexedDB 读缓存，立即渲染
    const cached = await trackDb.getItem<Track[]>("tracks").catch(() => null);
    if (cached?.length) tracks.value = cached;
    // 拿最新数据并回写缓存
    const [tracksRes, dirsRes] = await Promise.all([
      window.api.library.getTracks(),
      window.api.library.getScanDirs(),
    ]);
    if (tracksRes.success && tracksRes.data) {
      tracks.value = tracksRes.data;
      cacheTracks(tracksRes.data);
    }
    if (dirsRes.success && dirsRes.data) scanDirs.value = dirsRes.data;
    initialized.value = true;
    // 预取歌手头像
    loadArtistAvatars();
  };

  /** 开始扫描 */
  const startScan = async (incremental = true): Promise<void> => {
    if (scanning.value) return;
    scanning.value = true;
    scanProgress.value = { phase: "scanning", total: 0, scanned: 0 };
    try {
      const res = await window.api.library.scan(incremental);
      if (!res.success) {
        scanning.value = false;
        scanProgress.value = null;
      }
    } catch {
      scanning.value = false;
      scanProgress.value = null;
    }
  };

  /** 取消扫描 */
  const cancelScan = async (): Promise<void> => {
    await window.api.library.cancelScan();
    scanning.value = false;
    scanProgress.value = null;
  };

  /** 添加扫描目录 */
  const addScanDir = async (): Promise<{ success: boolean; error?: string }> => {
    const res = await window.api.library.addScanDir();
    if (res.success) {
      const newDir = res.data as string;
      const nested = scanDirs.value.some(
        (d) =>
          newDir.startsWith(d + "\\") ||
          newDir.startsWith(d + "/") ||
          d.startsWith(newDir + "\\") ||
          d.startsWith(newDir + "/"),
      );
      if (nested) {
        await window.api.library.removeScanDir(newDir);
        return { success: false, error: "nested" };
      }
      scanDirs.value = [...scanDirs.value, newDir];
    }
    return res;
  };

  /** 移除扫描目录 */
  const removeScanDir = async (dir: string): Promise<void> => {
    await window.api.library.removeScanDir(dir);
    scanDirs.value = scanDirs.value.filter((d) => d !== dir);
    const res = await window.api.library.getTracks();
    if (res.success && res.data) {
      tracks.value = res.data;
      cacheTracks(res.data);
      loadArtistAvatars();
    }
  };

  let unsubscribe: (() => void) | null = null;

  /** 监听扫描进度 */
  const subscribeScanProgress = (): void => {
    unsubscribe?.();
    unsubscribe = window.api.library.onScanProgress((data) => {
      scanProgress.value = data;
      if (data.phase === "done") {
        scanning.value = false;
        window.api.library.getTracks().then((res) => {
          if (res.success && res.data) {
            tracks.value = res.data;
            cacheTracks(res.data);
            loadArtistAvatars();
          }
        });
      } else if (data.phase === "error") {
        scanning.value = false;
      }
    });
  };

  const unsubscribeScanProgress = (): void => {
    unsubscribe?.();
    unsubscribe = null;
  };

  /** 删除曲目文件并刷新列表 */
  const deleteTracks = async (paths: string[]): Promise<{ deleted: number; failed: number }> => {
    const res = await window.api.library.deleteTracks(paths);
    if (res.success) {
      // 从本地列表中移除已删除的曲目
      const pathSet = new Set(paths);
      const remaining = tracks.value.filter((t) => !t.path || !pathSet.has(t.path));
      tracks.value = remaining;
      cacheTracks(remaining);
      return res.data ?? { deleted: 0, failed: paths.length };
    }
    return { deleted: 0, failed: paths.length };
  };

  /** 文件夹树：按磁盘路径聚合，详见 utils/folderTree */
  const folderTree = computed(() => buildFolderTree(tracks.value, scanDirs.value));

  /** 文件夹总数（递归） */
  const folderCount = computed(() => countFolders(folderTree.value));

  /** 专辑聚合列表 */
  const getAlbumList = async (): Promise<AlbumSummary[]> => {
    const res = await window.api.library.getAlbums();
    return res.success && res.data ? res.data : [];
  };

  /** 歌手聚合列表 */
  const getArtistList = async (): Promise<ArtistSummary[]> => {
    const res = await window.api.library.getArtists();
    return res.success && res.data ? res.data : [];
  };

  /** 专辑详情 */
  const getAlbumCollection = async (albumName: string): Promise<Collection | null> => {
    const res = await window.api.library.getAlbumTracks(albumName);
    if (!res.success || !res.data?.length) return null;
    const albumTracks = res.data;
    const artistMap = new Map<string, Artist>();
    for (const t of albumTracks) {
      for (const a of t.artists) {
        const key = a.name.toLowerCase();
        if (!artistMap.has(key)) artistMap.set(key, a);
      }
    }
    return {
      id: encodeURIComponent(albumName),
      type: "album",
      source: "local",
      title: albumName,
      cover: albumTracks.find((t) => t.cover)?.cover,
      artists: [...artistMap.values()],
      tracks: albumTracks,
      trackCount: albumTracks.length,
    };
  };

  /** 歌手详情 */
  const getArtistProfile = async (artistName: string): Promise<ArtistProfile | null> => {
    const name = artistName.trim();
    if (!name) return null;
    const res = await window.api.library.getArtistTracks(name);
    if (!res.success || !res.data?.length) return null;
    const artistTracks = res.data;
    const albumMap = new Map<string, { cover?: string; count: number }>();
    for (const t of artistTracks) {
      if (!t.album?.name) continue;
      const key = t.album.name;
      const existing = albumMap.get(key);
      if (existing) {
        existing.count++;
        if (!existing.cover && t.cover) existing.cover = t.cover;
      } else {
        albumMap.set(key, { cover: t.cover, count: 1 });
      }
    }
    const albums: CoverItem[] = [...albumMap.entries()].map(([albumName, info]) => ({
      id: encodeURIComponent(albumName),
      title: albumName,
      cover: info.cover,
      trackCount: info.count,
    }));
    return {
      id: encodeURIComponent(name),
      name,
      avatar: getArtistAvatar(name),
      source: "local",
      tracks: artistTracks,
      albums,
      trackCount: artistTracks.length,
      albumCount: albums.length,
    };
  };

  return {
    tracks,
    scanDirs,
    scanning,
    scanProgress,
    initialized,
    artistAvatars,
    load,
    startScan,
    cancelScan,
    addScanDir,
    removeScanDir,
    subscribeScanProgress,
    unsubscribeScanProgress,
    deleteTracks,
    getArtistAvatar,
    setArtistAvatar,
    loadArtistAvatars,
    getArtistList,
    getAlbumList,
    getAlbumCollection,
    getArtistProfile,
    folderTree,
    folderCount,
  };
});
