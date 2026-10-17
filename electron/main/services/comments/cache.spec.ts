// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoundedMap, coalesce } from "./cache";

describe("评论缓存 BoundedMap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("负缓存条目同样参与访问提升", () => {
    const cache = new BoundedMap<string, string | null>(2);
    cache.set("a", null);
    cache.set("b", "b");
    expect(cache.get("a")).toBeNull();
    cache.set("c", "c");
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeUndefined();
  });

  it("过期条目读取时返回 undefined 并被删除", () => {
    const cache = new BoundedMap<string, string>(2, 1000);
    cache.set("a", "a");
    vi.advanceTimersByTime(1001);
    expect(cache.get("a")).toBeUndefined();
  });

  it("包装后能区分缺失与存了 null", () => {
    const cache = new BoundedMap<string, string | null>(2);
    cache.set("a", null);
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeUndefined();
  });

  it("超过上限时淘汰最久未使用的条目", () => {
    const cache = new BoundedMap<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });
});

describe("在途请求合并 coalesce", () => {
  it("同 key 并发只调用一次工厂", async () => {
    const inflight = new Map<string, Promise<number>>();
    const factory = vi.fn(async () => 1);
    const [first, second] = await Promise.all([
      coalesce(inflight, "k", factory),
      coalesce(inflight, "k", factory),
    ]);
    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("成功与失败后都移除在途项", async () => {
    const inflight = new Map<string, Promise<number>>();
    await coalesce(inflight, "ok", async () => 1);
    expect(inflight.size).toBe(0);
    await expect(
      coalesce(inflight, "fail", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(inflight.size).toBe(0);
  });

  it("不同 key 不共享在途请求", async () => {
    const inflight = new Map<string, Promise<string>>();
    const factory = vi.fn(async (value: string) => value);
    await Promise.all([
      coalesce(inflight, "a", () => factory("a")),
      coalesce(inflight, "b", () => factory("b")),
    ]);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
