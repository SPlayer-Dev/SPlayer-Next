import { defineStore } from "pinia";
import type { Track } from "@shared/types/player";
import type { ScanProgress } from "@shared/types/library";

export const useLibraryStore = defineStore("library", () => {
  const tracks = shallowRef<Track[]>([]);
  const scanDirs = ref<string[]>([]);
  const scanning = ref(false);
  const scanProgress = ref<ScanProgress | null>(null);
  const initialized = ref(false);

  /** 从主进程加载曲目和目录列表 */
  const load = async (): Promise<void> => {
    const [tracksRes, dirsRes] = await Promise.all([
      window.api.library.getTracks(),
      window.api.library.getScanDirs(),
    ]);
    if (tracksRes.success && tracksRes.data) tracks.value = tracksRes.data;
    if (dirsRes.success && dirsRes.data) scanDirs.value = dirsRes.data;
    initialized.value = true;
  };

  /** 开始扫描 */
  const startScan = async (incremental = true): Promise<void> => {
    if (scanning.value) return;
    scanning.value = true;
    scanProgress.value = { phase: "scanning", total: 0, scanned: 0 };
    await window.api.library.scan(incremental);
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
    if (res.success && res.data) tracks.value = res.data;
  };

  let unsubscribe: (() => void) | null = null;

  /** 监听扫描进度，scanning 阶段增量追加 tracks */
  const subscribeScanProgress = (): void => {
    unsubscribe?.();
    unsubscribe = window.api.library.onScanProgress((data) => {
      const progress = data as ScanProgress;
      scanProgress.value = progress;
      if (progress.phase === "done") {
        scanning.value = false;
        window.api.library.getTracks().then((res) => {
          if (res.success && res.data) tracks.value = res.data;
        });
      } else if (progress.phase === "error") {
        scanning.value = false;
      }
    });
  };

  const unsubscribeScanProgress = (): void => {
    unsubscribe?.();
    unsubscribe = null;
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
  };
});
