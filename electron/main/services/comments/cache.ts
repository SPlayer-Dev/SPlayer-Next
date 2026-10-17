/** 单条缓存记录，包装后 get 的 undefined 才能唯一表示「不存在」 */
interface CacheEntry<V> {
  value: V;
  /** 过期时间戳（毫秒），0 表示永不过期 */
  expireAt: number;
}

/**
 * 有界 LRU 缓存，可选用 TTL
 * 以条目包装存储，负缓存（null / 空数组）同样参与访问提升与淘汰
 */
export class BoundedMap<K, V> {
  private readonly map = new Map<K, CacheEntry<V>>();

  /**
   * @param limit - 最大条目数，超出时淘汰最久未使用的条目
   * @param ttlMs - 条目存活时长（毫秒），省略表示永不过期
   */
  constructor(
    private readonly limit: number,
    private readonly ttlMs?: number,
  ) {}

  /**
   * 读取缓存值，命中时提升为最近使用，过期条目读取时清除
   * @param key - 缓存键
   * @returns 缓存值，不存在或已过期时返回 undefined
   */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expireAt && entry.expireAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    if (this.map.size > 1) {
      this.map.delete(key);
      this.map.set(key, entry);
    }
    return entry.value;
  }

  /**
   * 写入缓存值并淘汰超限的最旧条目
   * @param key - 缓存键
   * @param value - 缓存值
   */
  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, {
      value,
      expireAt: this.ttlMs ? Date.now() + this.ttlMs : 0,
    });
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

/**
 * 合并同 key 的并发请求，Promise 落定后自动移除在途项
 * @param inflight - 在途请求表
 * @param key - 去重键
 * @param factory - 实际请求工厂
 * @returns 共享的请求 Promise
 */
export const coalesce = <K, T>(
  inflight: Map<K, Promise<T>>,
  key: K,
  factory: () => Promise<T>,
): Promise<T> => {
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = factory().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
};
