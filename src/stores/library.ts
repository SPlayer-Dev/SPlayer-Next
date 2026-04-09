import localforage from "localforage";
import type { Track } from "@shared/types/player";
import type { ScanProgress } from "@shared/types/library";
import type { Collection } from "@/types/collection";
import type { ArtistProfile } from "@/types/artist";

const trackDb = localforage.createInstance({ name: "splayer", storeName: "library" });

export const useLibraryStore = defineStore("library", () => {
  const tracks = shallowRef<Track[]>([]);
  const scanDirs = ref<string[]>([]);
  const scanning = ref(false);
  const scanProgress = ref<ScanProgress | null>(null);
  const initialized = ref(false);

  /** 将曲目写入 IndexedDB 缓存 */
  const cacheTracks = (items: Track[]): void => {
    trackDb.setItem("tracks", toRaw(items)).catch(() => {});
  };

  /** 从主进程加载曲目和目录列表，优先从 IndexedDB 缓存恢复 */
  const load = async (): Promise<void> => {
    // 先从 IndexedDB 读缓存，立即渲染
    const cached = await trackDb.getItem<Track[]>("tracks").catch(() => null);
    if (cached?.length) tracks.value = markRaw(cached);

    // 再从主进程拿最新数据并回写缓存
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

  /** 根据专辑名从曲库聚合出 Collection */
  const getAlbumCollection = (albumName: string): Collection | null => {
    const albumTracks = tracks.value.filter((t) => t.album?.name === albumName);
    if (!albumTracks.length) return null;
    // 收集所有不重复的艺术家
    const artistMap = new Map<string, { id?: string; name: string }>();
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

  /** 根据歌手名从曲库聚合出 ArtistProfile */
  const getArtistProfile = (artistName: string): ArtistProfile | null => {
    const name = artistName.trim();
    if (!name) return null;
    const nameLower = name.toLowerCase();
    const artistTracks = tracks.value.filter((t) =>
      t.artists.some((a) => a.name.toLowerCase() === nameLower),
    );
    if (!artistTracks.length) return null;
    // 聚合专辑
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
    const albums = [...albumMap.entries()].map(([albumName, info]) => ({
      id: encodeURIComponent(albumName),
      title: albumName,
      cover: info.cover,
      trackCount: info.count,
    }));
    return {
      id: encodeURIComponent(name),
      name,
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
    load,
    startScan,
    cancelScan,
    addScanDir,
    removeScanDir,
    subscribeScanProgress,
    unsubscribeScanProgress,
    deleteTracks,
    getAlbumCollection,
    getArtistProfile,
  };
});
