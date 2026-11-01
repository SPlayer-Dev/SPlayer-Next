import fs from "node:fs/promises";
import path from "node:path";
import { writeFile as atomicWrite } from "atomically";
import { pluginsDir } from "@main/utils/paths";

interface CachedData {
  data: Record<string, unknown>;
  bytes: number;
}

const MAX_CACHE_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 16;
const caches = new Map<string, CachedData>();
const pending = new Map<string, Promise<unknown>>();
let cacheBytes = 0;
let closing = false;

/** 所有插件数据的根目录 */
export const getPluginsDataDir = (): string => path.join(pluginsDir, "data");

const fileOf = (pluginId: string): string => path.join(getPluginsDataDir(), `${pluginId}.json`);

/**
 * 释放缓存并同步缓存大小
 * @param pluginId - 插件标识
 */
const evict = (pluginId: string): void => {
  const cached = caches.get(pluginId);
  if (!cached) return;
  cacheBytes -= cached.bytes;
  caches.delete(pluginId);
};

/**
 * 按序列化大小与最近访问顺序限制缓存，大文件仅落盘
 * @param pluginId - 插件标识
 * @param data - 已读取或写入的数据
 * @param bytes - 序列化数据的字节数
 */
const cache = (pluginId: string, data: Record<string, unknown>, bytes: number): void => {
  evict(pluginId);
  if (bytes > MAX_CACHE_BYTES) return;
  while (cacheBytes + bytes > MAX_CACHE_BYTES || caches.size >= MAX_CACHE_ENTRIES) {
    evict(caches.keys().next().value!);
  }
  caches.set(pluginId, { data, bytes });
  cacheBytes += bytes;
};

/**
 * 同一插件的读写按调用顺序执行，失败不阻塞后续操作
 * @param pluginId - 插件标识
 * @param operation - 本次存储操作
 * @returns 本次操作的结果
 */
const enqueue = <T>(pluginId: string, operation: () => Promise<T>): Promise<T> => {
  if (closing) return Promise.reject(new Error("Plugin storage is shutting down"));
  const previous = pending.get(pluginId) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(operation);
  pending.set(pluginId, task);
  const cleanup = (): void => {
    if (pending.get(pluginId) === task) pending.delete(pluginId);
  };
  void task.then(cleanup, cleanup);
  return task;
};

/**
 * 读取已保存的数据，读取失败时保留原文件并向调用方报错
 * @param pluginId - 插件标识
 * @returns 插件数据
 */
const load = async (pluginId: string): Promise<Record<string, unknown>> => {
  const cached = caches.get(pluginId);
  if (cached) {
    caches.delete(pluginId);
    caches.set(pluginId, cached);
    return cached.data;
  }
  let raw: string;
  try {
    raw = await fs.readFile(fileOf(pluginId), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const data = JSON.parse(raw) as Record<string, unknown>;
  cache(pluginId, data, Buffer.byteLength(raw, "utf8"));
  return data;
};

/**
 * 原子写入成功后更新缓存，避免磁盘失败时内存出现未保存的数据
 * @param pluginId - 插件标识
 * @param data - 完整插件数据
 */
const flush = async (pluginId: string, data: Record<string, unknown>): Promise<void> => {
  const serialized = JSON.stringify(data, null, 2);
  await fs.mkdir(getPluginsDataDir(), { recursive: true });
  await atomicWrite(fileOf(pluginId), serialized);
  cache(pluginId, data, Buffer.byteLength(serialized, "utf8"));
};

/**
 * 按调用顺序读取指定键
 * @param pluginId - 插件标识
 * @param key - 存储键名
 * @returns 已保存的值，不存在时为 null
 */
export const pluginStorageGet = (pluginId: string, key: string): Promise<unknown> =>
  enqueue(pluginId, async () => (await load(pluginId))[key] ?? null);

/**
 * 写入指定键并等待原子落盘完成
 * @param pluginId - 插件标识
 * @param key - 存储键名
 * @param value - 可 JSON 序列化的值
 */
export const pluginStorageSet = (pluginId: string, key: string, value: unknown): Promise<void> =>
  enqueue(pluginId, async () => {
    const data = { ...(await load(pluginId)), [key]: value };
    await flush(pluginId, data);
  });

/**
 * 删除指定键并等待原子落盘完成
 * @param pluginId - 插件标识
 * @param key - 存储键名
 */
export const pluginStorageRemove = (pluginId: string, key: string): Promise<void> =>
  enqueue(pluginId, async () => {
    const current = await load(pluginId);
    if (!Object.hasOwn(current, key)) return;
    const next = { ...current };
    delete next[key];
    await flush(pluginId, next);
  });

/**
 * 按调用顺序读取全部存储键名
 * @param pluginId - 插件标识
 * @returns 插件已保存的键名
 */
export const pluginStorageKeys = (pluginId: string): Promise<string[]> =>
  enqueue(pluginId, async () => Object.keys(await load(pluginId)));

/**
 * 等待插件已有操作结束后释放缓存
 * @param pluginId - 插件标识
 */
export const pluginStorageRelease = (pluginId: string): Promise<void> =>
  enqueue(pluginId, async () => evict(pluginId));

/**
 * 等待已有操作结束后删除数据，避免迟到的写入恢复文件
 * @param pluginId - 插件标识
 */
export const pluginStorageDrop = (pluginId: string): Promise<void> =>
  enqueue(pluginId, async () => {
    await fs.rm(fileOf(pluginId), { force: true });
    evict(pluginId);
  });

/** 停止接受新操作，等待所有插件存储操作完成并释放缓存 */
export const shutdownPluginStorage = async (): Promise<void> => {
  closing = true;
  const results = await Promise.allSettled(pending.values());
  caches.clear();
  cacheBytes = 0;
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
};
