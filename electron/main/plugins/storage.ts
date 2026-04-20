/**
 * 每插件隔离的 KV 存储
 *
 * 落盘：`{userData}/plugins/data/{pluginId}.json`
 * 原子写（atomically）防撕裂；内存缓存避免频繁读。
 */

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";

/** 所有插件数据的根目录 */
export const getPluginsDataDir = (): string =>
  path.join(app.getPath("userData"), "plugins", "data");

const caches = new Map<string, Record<string, unknown>>();

const ensureDir = (): void => {
  const dir = getPluginsDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const fileOf = (pluginId: string): string =>
  path.join(getPluginsDataDir(), `${pluginId}.json`);

const load = (pluginId: string): Record<string, unknown> => {
  const cached = caches.get(pluginId);
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(fileOf(pluginId), "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    caches.set(pluginId, data);
    return data;
  } catch {
    const empty: Record<string, unknown> = {};
    caches.set(pluginId, empty);
    return empty;
  }
};

const flush = (pluginId: string, data: Record<string, unknown>): void => {
  ensureDir();
  atomicWriteSync(fileOf(pluginId), JSON.stringify(data, null, 2));
  caches.set(pluginId, data);
};

export const pluginStorageGet = (pluginId: string, key: string): unknown => {
  return load(pluginId)[key] ?? null;
};

export const pluginStorageSet = (pluginId: string, key: string, value: unknown): void => {
  const data = { ...load(pluginId), [key]: value };
  flush(pluginId, data);
};

export const pluginStorageRemove = (pluginId: string, key: string): void => {
  const cur = load(pluginId);
  if (!(key in cur)) return;
  const next = { ...cur };
  delete next[key];
  flush(pluginId, next);
};

export const pluginStorageKeys = (pluginId: string): string[] => {
  return Object.keys(load(pluginId));
};

/** 彻底删除某插件的数据文件与缓存 */
export const pluginStorageDrop = (pluginId: string): void => {
  caches.delete(pluginId);
  try {
    fs.unlinkSync(fileOf(pluginId));
  } catch {
    /* ignore */
  }
};
