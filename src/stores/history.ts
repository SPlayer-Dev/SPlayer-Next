import localforage from "localforage";
import type { Track } from "@shared/types/player";

const db = localforage.createInstance({ name: "splayer", storeName: "history" });
const HISTORY_KEY = "entries";

/** 历史条数上限，超出按时间倒序裁掉尾部 */
const MAX_HISTORY = 500;

/** 单条播放历史 */
export interface HistoryEntry {
  track: Track;
  /** 最近一次播放时间（unix ms） */
  playedAt: number;
}

/** 同源同 id 视为同一首 */
const keyOf = (track: Track): string => `${track.source}:${track.id}`;

export const useHistoryStore = defineStore("history", () => {
  /** 倒序：最近播放在前 */
  const entries = shallowRef<HistoryEntry[]>([]);
  let loaded = false;

  /** 持久化 */
  const persist = (): void => {
    void db.setItem(HISTORY_KEY, toRaw(entries.value)).catch(() => {});
  };

  /** 启动时读一次盘，之后内存为真值源 */
  const load = async (): Promise<void> => {
    if (loaded) return;
    loaded = true;
    const cached = await db.getItem<HistoryEntry[]>(HISTORY_KEY).catch(() => null);
    if (Array.isArray(cached)) entries.value = cached;
  };

  /**
   * 记录一次播放：同源同 id 去重后置顶
   * @param track 当前播放曲目
   */
  const record = (track: Track): void => {
    if (!track?.id) return;
    const key = keyOf(track);
    const filtered = entries.value.filter((item) => keyOf(item.track) !== key);
    entries.value = [{ track, playedAt: Date.now() }, ...filtered].slice(0, MAX_HISTORY);
    persist();
  };

  /**
   * 移除单条历史
   * @param track 要删除的曲目
   */
  const remove = (track: Track): void => {
    const key = keyOf(track);
    const next = entries.value.filter((entry) => keyOf(entry.track) !== key);
    if (next.length === entries.value.length) return;
    entries.value = next;
    persist();
  };

  /** 清空全部历史 */
  const clear = (): void => {
    entries.value = [];
    persist();
  };

  /** 按时间倒序的扁平曲目列表 */
  const tracks = computed<Track[]>(() => entries.value.map((entry) => entry.track));

  return {
    entries,
    tracks,
    load,
    record,
    remove,
    clear,
  };
});
