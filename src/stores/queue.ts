import localforage from "localforage";
import type { PlaybackContext, PlaybackQueueItem, Track } from "@shared/types/player";

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

type PersistedQueueItem = Track | PlaybackQueueItem;

/** 兼容旧版本直接持久化的 Track 队列 */
const restoreQueueItem = (value: PersistedQueueItem): PlaybackQueueItem => {
  if (typeof value.track === "object" && value.track !== null) return value as PlaybackQueueItem;
  return { track: value as Track };
};

const createQueueItem = (track: Track, context?: PlaybackContext): PlaybackQueueItem =>
  context ? { track, context } : { track };

/** 当前播放队列项 */
export const queueEntries = shallowRef<PlaybackQueueItem[]>([]);

/** 供界面和音源预载消费的纯曲目列表 */
export const queue = computed<Track[]>(() => queueEntries.value.map((item) => item.track));

/** 原始队列顺序备份 */
export const originalQueue = shallowRef<PlaybackQueueItem[] | null>(null);

/** 队列中的歌曲总数 */
export const queueLength = computed(() => queue.value.length);

/** 保存当前播放列表数据 */
const save = (): void => {
  db.setItem("playList", toRaw(queueEntries.value)).catch(console.error);
  db.setItem("originalPlayList", toRaw(originalQueue.value)).catch(console.error);
};

/** 恢复播放列表数据 */
export const restoreQueue = async (): Promise<void> => {
  try {
    const [list, original] = await Promise.all([
      db.getItem<PersistedQueueItem[]>("playList"),
      db.getItem<PersistedQueueItem[] | null>("originalPlayList"),
    ]);
    if (!list?.length) return;
    queueEntries.value = list.map(restoreQueueItem);
    originalQueue.value = original?.map(restoreQueueItem) ?? null;
  } catch (e) {
    console.error("[queue] 恢复持久化数据失败:", e);
  }
};

/**
 * 替换整个队列，清除洗牌备份
 * @param items - 新的歌曲列表
 * @param context - 队列中曲目共用的播放来源上下文
 */
export const setQueue = (items: readonly Track[], context?: PlaybackContext): void => {
  queueEntries.value = items.map((track) => createQueueItem(track, context));
  originalQueue.value = null;
  save();
};

/**
 * 在指定位置插入一首歌，同时同步到 originalQueue
 * @param item - 要插入的歌曲
 * @param index - 插入位置（该位置原有元素后移）
 * @param context - 播放来源上下文
 */
export const insertToQueue = (item: Track, index: number, context?: PlaybackContext): void => {
  const entry = createQueueItem(item, context);
  const safeIndex = Math.max(0, Math.min(index, queueEntries.value.length));
  const next = [...queueEntries.value];
  next.splice(safeIndex, 0, entry);
  queueEntries.value = next;
  if (originalQueue.value) {
    originalQueue.value = [...originalQueue.value, entry];
  }
  save();
};

/**
 * 在指定位置批量插入曲目，一次性切片与持久化（避免逐首插入的 O(n²) 与多次落盘）
 * @param items - 要插入的歌曲
 * @param index - 插入位置（该位置原有元素后移）
 * @param context - 播放来源上下文
 */
export const insertManyToQueue = (
  items: Track[],
  index: number,
  context?: PlaybackContext,
): void => {
  if (items.length === 0) return;
  const entries = items.map((track) => createQueueItem(track, context));
  const list = queueEntries.value;
  const safeIndex = Math.max(0, Math.min(index, list.length));
  queueEntries.value = [...list.slice(0, safeIndex), ...entries, ...list.slice(safeIndex)];
  if (originalQueue.value) {
    originalQueue.value = [...originalQueue.value, ...entries];
  }
  save();
};

/**
 * 按 id 替换队列中的曲目数据（标签编辑后同步显示）
 * @param updates - 更新后的 Track 列表
 */
export const updateQueueTracks = (updates: readonly Track[]): void => {
  if (updates.length === 0) return;
  const byId = new Map(updates.map((item) => [item.id, item]));
  const touched =
    queueEntries.value.some((item) => byId.has(item.track.id)) ||
    (originalQueue.value?.some((item) => byId.has(item.track.id)) ?? false);
  if (!touched) return;
  queueEntries.value = queueEntries.value.map((item) => ({
    ...item,
    track: byId.get(item.track.id) ?? item.track,
  }));
  if (originalQueue.value) {
    originalQueue.value = originalQueue.value.map((item) => ({
      ...item,
      track: byId.get(item.track.id) ?? item.track,
    }));
  }
  save();
};

/**
 * 更新队列项的曲目和播放上下文
 * @param index - 队列索引
 * @param track - 曲目
 * @param context - 播放来源上下文
 */
export const updateQueueItem = (index: number, track: Track, context?: PlaybackContext): void => {
  if (index < 0 || index >= queueEntries.value.length) return;
  const previous = queueEntries.value[index];
  const replacement = createQueueItem(track, context);
  const next = [...queueEntries.value];
  next[index] = replacement;
  queueEntries.value = next;
  if (originalQueue.value) {
    originalQueue.value = originalQueue.value.map((item) =>
      item.track.id === previous.track.id ? replacement : item,
    );
  }
  save();
};

/**
 * 移除指定服务器的全部流媒体歌曲
 * @param serverId - 服务器 ID
 */
export const removeServerTracks = (serverId: string): void => {
  const belongsToServer = (track: Track): boolean =>
    track.source === "streaming" && track.serverId === serverId;
  const next = queueEntries.value.filter((item) => !belongsToServer(item.track));
  const nextOriginal = originalQueue.value?.filter((item) => !belongsToServer(item.track)) ?? null;
  if (
    next.length === queueEntries.value.length &&
    nextOriginal?.length === originalQueue.value?.length
  ) {
    return;
  }
  queueEntries.value = next;
  originalQueue.value = nextOriginal;
  save();
};

/**
 * 移除指定位置的歌曲，同时从 originalQueue 中移除同 ID 的歌
 * @param index - 要移除的位置，越界时静默忽略
 */
export const removeFromQueue = (index: number): void => {
  if (index < 0 || index >= queueEntries.value.length) return;
  const removed = queueEntries.value[index];
  const next = [...queueEntries.value];
  next.splice(index, 1);
  queueEntries.value = next;
  if (originalQueue.value) {
    const origIdx = originalQueue.value.findIndex((item) => item.track.id === removed.track.id);
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
  if (fromIndex < 0 || fromIndex >= queueEntries.value.length) return;
  if (toIndex < 0 || toIndex >= queueEntries.value.length) return;
  const next = [...queueEntries.value];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  queueEntries.value = next;
  save();
};

/**
 * 清空队列和洗牌备份
 */
export const clearQueue = (): void => {
  queueEntries.value = [];
  originalQueue.value = null;
  save();
};

/**
 * 洗牌：备份当前顺序到 originalQueue（仅首次），将 keepIndex 处的歌曲置于首位，其余随机打乱
 * @param keepIndex - 保持在首位的歌曲索引（通常是当前正在播放的歌）
 */
export const shuffleQueue = (keepIndex: number): void => {
  const currentQueue = queueEntries.value;
  if (currentQueue.length <= 1) return;
  const safeIndex = keepIndex >= 0 && keepIndex < currentQueue.length ? keepIndex : 0;
  // 仅首次洗牌时备份，避免重新洗牌时覆盖原始顺序
  if (!originalQueue.value) {
    originalQueue.value = [...currentQueue];
  }
  const keepTrack = currentQueue[safeIndex];
  const rest = currentQueue.filter((_, index) => index !== safeIndex);
  shuffleArray(rest);
  queueEntries.value = [keepTrack, ...rest];
  save();
};

/**
 * 取消洗牌：用 originalQueue 恢复队列顺序，清除备份
 * @param currentTrackId - 当前播放歌曲的 ID，用于在原始队列中定位
 * @returns 该歌曲在原始队列中的新索引（供调用方更新播放位置）
 */
export const unshuffleQueue = (currentTrackId: string): number => {
  if (!originalQueue.value) return 0;
  queueEntries.value = [...originalQueue.value];
  originalQueue.value = null;
  save();
  const idx = queueEntries.value.findIndex((item) => item.track.id === currentTrackId);
  return idx !== -1 ? idx : 0;
};

/**
 * 根据索引获取 Track
 * @param index - 队列索引
 * @returns 对应的 Track，越界时返回 null
 */
export const getTrack = (index: number): Track | null => {
  return getQueueItem(index)?.track ?? null;
};

/**
 * 根据索引获取队列项
 * @param index - 队列索引
 * @returns 队列项，越界时返回 null
 */
export const getQueueItem = (index: number): PlaybackQueueItem | null => {
  return index >= 0 && index < queueEntries.value.length ? queueEntries.value[index] : null;
};

/**
 * 根据 ID 查找 Track 在队列中的索引
 * @param trackId - 歌曲 ID
 * @returns 索引位置，未找到返回 -1
 */
export const findTrackIndex = (trackId: string): number => {
  return queueEntries.value.findIndex((item) => item.track.id === trackId);
};
