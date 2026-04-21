/**
 * 接口响应内存缓存
 *
 * 对齐原 @neteasecloudmusicapienhanced/api util/apicache.js 的行为：
 * - 默认 2 分钟 TTL
 * - 只缓存 status === 200 的响应
 * - key = `${name}|${md5(params)}`
 */

import { createHash } from "node:crypto";

/** 默认 TTL：2 分钟 */
const DEFAULT_TTL = 2 * 60 * 1000;

/** 容量上限：超过后 LRU 淘汰 */
const MAX_ENTRIES = 200;

interface CacheEntry {
  value: { status: number; body: unknown };
  expireAt: number;
}

const store = new Map<string, CacheEntry>();

/** 快速稳定 hash：JSON.stringify + md5 8 位前缀 */
const hash = (params: unknown): string =>
  createHash("md5")
    .update(JSON.stringify(params ?? {}))
    .digest("hex")
    .slice(0, 8);

/** 构造缓存 key */
export const buildCacheKey = (name: string, params: unknown): string =>
  `${name}|${hash(params)}`;

/**
 * 获取缓存
 * @param key 缓存 key
 * @returns 缓存 value
 */
export const cacheGet = (key: string): CacheEntry["value"] | undefined => {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expireAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  // LRU：命中时重新插入到末尾
  store.delete(key);
  store.set(key, hit);
  return hit.value;
};

/**
 * 设置缓存
 * @param key 缓存 key
 * @param value 缓存 value
 * @param ttl 缓存 TTL
 */
export const cacheSet = (
  key: string,
  value: CacheEntry["value"],
  ttl: number = DEFAULT_TTL,
): void => {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expireAt: Date.now() + ttl });
};

/** 清空全部 */
export const cacheClear = (): void => {
  store.clear();
};
