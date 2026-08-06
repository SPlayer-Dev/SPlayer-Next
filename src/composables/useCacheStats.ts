type CacheKind = "file" | "db";

interface CacheStat {
  id: string;
  kind: CacheKind;
  path: string;
  size: number;
}

const stats = ref<CacheStat[]>([
  { id: "covers", kind: "file", path: "", size: 0 },
  { id: "artists", kind: "file", path: "", size: 0 },
  { id: "backgrounds", kind: "file", path: "", size: 0 },
  { id: "songs", kind: "file", path: "", size: 0 },
  { id: "lyric", kind: "db", path: "", size: 0 },
  { id: "lyricTTML", kind: "db", path: "", size: 0 },
  { id: "lyricMatch", kind: "db", path: "", size: 0 },
]);
const cacheDir = ref<string>("");
const loading = ref(false);
const clearingId = ref<string | null>(null);
const clearingKind = ref<CacheKind | null>(null);
let initialized = false;

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

const load = (): void => {
  if (initialized) return;
  initialized = true;
  void refresh();
};

export const useCacheStats = () => ({
  stats,
  cacheDir,
  loading,
  clearingId,
  clearingKind,
  load,
  refresh,
  setCacheDir,
});

export type { CacheKind, CacheStat };
