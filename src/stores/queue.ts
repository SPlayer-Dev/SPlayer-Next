import localforage from "localforage";
import type { Track } from "@shared/types/player";

/** 持久化存储实例 */
const db = localforage.createInstance({ name: "splayer", storeName: "queue" });

/** Fisher-Yates 洗牌 */
const shuffleArray = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

/** 当前播放队列 */
export const queue = shallowRef<Track[]>([]);

/** 原始队列顺序备份 */
export const originalQueue = shallowRef<Track[] | null>(null);

/** 队列中的歌曲总数 */
export const queueLength = computed(() => queue.value.length);

/** 保存当前播放列表数据 */
const save = (): void => {
  db.setItem("playList", toRaw(queue.value)).catch(console.error);
  db.setItem("originalPlayList", toRaw(originalQueue.value)).catch(console.error);
};

/** 恢复播放列表数据 */
export const restoreQueue = async (): Promise<void> => {
  try {
    const [list, original] = await Promise.all([
      db.getItem<Track[]>("playList"),
      db.getItem<Track[] | null>("originalPlayList"),
    ]);
    if (!list?.length) return;
    queue.value = list;
    originalQueue.value = original ?? null;
  } catch (e) {
    console.error("[queue] 恢复持久化数据失败:", e);
  }
};

/**
 * 替换整个队列，清除洗牌备份
 * @param items - 新的歌曲列表
 */
export const setQueue = (items: readonly Track[]): void => {
  queue.value = [...items];
  originalQueue.value = null;
  save();
};

/**
 * 在指定位置插入一首歌，同时同步到 originalQueue
 * @param item - 要插入的歌曲
 * @param index - 插入位置（该位置原有元素后移）
 */
export const insertToQueue = (item: Track, index: number): void => {
  const safeIndex = Math.max(0, Math.min(index, queue.value.length));
  const next = [...queue.value];
  next.splice(safeIndex, 0, item);
  queue.value = next;
  if (originalQueue.value) {
    originalQueue.value = [...originalQueue.value, item];
  }
  save();
};

/**
 * 在指定位置批量插入曲目，一次性切片与持久化（避免逐首插入的 O(n²) 与多次落盘）
 * @param items - 要插入的歌曲
 * @param index - 插入位置（该位置原有元素后移）
 */
export const insertManyToQueue = (items: Track[], index: number): void => {
  if (items.length === 0) return;
  const list = queue.value;
  const safeIndex = Math.max(0, Math.min(index, list.length));
  queue.value = [...list.slice(0, safeIndex), ...items, ...list.slice(safeIndex)];
  if (originalQueue.value) {
    originalQueue.value = [...originalQueue.value, ...items];
  }
  save();
};

/**
 * 移除指定位置的歌曲，同时从 originalQueue 中移除同 ID 的歌
 * @param index - 要移除的位置，越界时静默忽略
 */
export const removeFromQueue = (index: number): void => {
  if (index < 0 || index >= queue.value.length) return;
  const removed = queue.value[index];
  const next = [...queue.value];
  next.splice(index, 1);
  queue.value = next;
  if (originalQueue.value) {
    const origIdx = originalQueue.value.findIndex((t) => t.id === removed.id);
    if (origIdx !== -1) {
      const nextOrig = [...originalQueue.value];
      nextOrig.splice(origIdx, 1);
      originalQueue.value = nextOrig;
    }
  }
  save();
};

/**
 * 将歌曲从一个位置移动到另一个位置
 * @param fromIndex - 原位置
 * @param toIndex - 目标位置
 */
export const moveInQueue = (fromIndex: number, toIndex: number): void => {
  if (fromIndex === toIndex) return;
  if (fromIndex < 0 || fromIndex >= queue.value.length) return;
  if (toIndex < 0 || toIndex >= queue.value.length) return;
  const next = [...queue.value];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  queue.value = next;
  save();
};

/**
 * 清空队列和洗牌备份
 */
export const clearQueue = (): void => {
  queue.value = [];
  originalQueue.value = null;
  save();
};

/**
 * 洗牌：备份当前顺序到 originalQueue（仅首次），将 keepIndex 处的歌曲置于首位，其余随机打乱
 * @param keepIndex - 保持在首位的歌曲索引（通常是当前正在播放的歌）
 */
export const shuffleQueue = (keepIndex: number): void => {
  const currentQueue = queue.value;
  if (currentQueue.length <= 1) return;
  const safeIndex = keepIndex >= 0 && keepIndex < currentQueue.length ? keepIndex : 0;
  // 仅首次洗牌时备份，避免重新洗牌时覆盖原始顺序
  if (!originalQueue.value) {
    originalQueue.value = [...currentQueue];
  }
  const keepTrack = currentQueue[safeIndex];
  const rest = currentQueue.filter((_, index) => index !== safeIndex);
  shuffleArray(rest);
  queue.value = [keepTrack, ...rest];
  save();
};

/**
 * 取消洗牌：用 originalQueue 恢复队列顺序，清除备份
 * @param currentTrackId - 当前播放歌曲的 ID，用于在原始队列中定位
 * @returns 该歌曲在原始队列中的新索引（供调用方更新播放位置）
 */
export const unshuffleQueue = (currentTrackId: string): number => {
  if (!originalQueue.value) return 0;
  queue.value = [...originalQueue.value];
  originalQueue.value = null;
  save();
  const idx = queue.value.findIndex((t) => t.id === currentTrackId);
  return idx !== -1 ? idx : 0;
};

/**
 * 根据索引获取 Track
 * @param index - 队列索引
 * @returns 对应的 Track，越界时返回 null
 */
export const getTrack = (index: number): Track | null => {
  return index >= 0 && index < queue.value.length ? queue.value[index] : null;
};

/**
 * 根据 ID 查找 Track 在队列中的索引
 * @param trackId - 歌曲 ID
 * @returns 索引位置，未找到返回 -1
 */
export const findTrackIndex = (trackId: string): number => {
  return queue.value.findIndex((track) => track.id === trackId);
};
