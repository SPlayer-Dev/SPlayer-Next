/**
 * KG 主进程服务
 *
 * 与 netease 不同之处：
 * - 无账号体系、无 cookie、无加密 body，纯 fetch GET
 * - 搜索走 songsearch.kugou.com；歌词走 lyrics.kugou.com（需 KG-RC/KG-THash/UA 伪装）
 * - 歌词是 hash + 歌名 + 时长 三元组匹配（KG 特有，不能只凭 ID）
 *
 * 统一入口：callKugou(name, params)
 */

import { createHash } from "node:crypto";
import { modules } from "./modules";
import type { KGParams } from "./core/types";

/** 2 分钟响应缓存 */
const DEFAULT_TTL = 2 * 60 * 1000;
const MAX_ENTRIES = 200;

interface CacheEntry {
  value: unknown;
  expireAt: number;
}

const cache = new Map<string, CacheEntry>();

const hashParams = (params: unknown): string =>
  createHash("md5")
    .update(JSON.stringify(params ?? {}))
    .digest("hex")
    .slice(0, 8);

const cacheGet = (key: string): unknown => {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expireAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
};

const cacheSet = (key: string, value: unknown, ttl = DEFAULT_TTL): void => {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expireAt: Date.now() + ttl });
};

export const clearKugouCache = (): void => {
  cache.clear();
};

/**
 * 调用任意 KG API
 * @param name   见 modules/index.ts（search / lyric）
 * @param params 业务参数；不想命中缓存可传 `timestamp: Date.now()`
 */
export const callKugou = async (name: string, params: KGParams = {}): Promise<unknown> => {
  const fn = modules[name];
  if (!fn) throw new Error(`unknown kg api: ${name}`);

  const key = `${name}|${hashParams(params)}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  const value = await fn(params);
  cacheSet(key, value);
  return value;
};
