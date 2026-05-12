type CacheKind = "file" | "db";

interface CacheStat {
  id: string;
  kind: CacheKind;
  path: string;
  size: number;
}

const stats = ref<CacheStat[]>([]);
const cacheDir = ref<string>("");
const loading = ref(false);
const clearingId = ref<string | null>(null);
const clearingKind = ref<CacheKind | null>(null);

const refresh = async (): Promise<void> => {
  loading.value = true;
  try {
    const [list, dir] = await Promise.all([window.api.cache.getStats(), window.api.cache.getDir()]);
    stats.value = list;
    cacheDir.value = dir;
  } finally {
    loading.value = false;
  }
};

const setCacheDir = (dir: string): void => {
  cacheDir.value = dir;
};

export const useCacheStats = () => ({
  stats,
  cacheDir,
  loading,
  clearingId,
  clearingKind,
  refresh,
  setCacheDir,
});

export type { CacheKind, CacheStat };
