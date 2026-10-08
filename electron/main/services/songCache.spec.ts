// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SongCacheRow } from "@main/database/songCache";

const state = vi.hoisted(() => ({
  directory: "",
  rows: new Map<string, SongCacheRow>(),
  limit: 64 / 1024 ** 3,
}));
vi.mock("electron", () => ({ app: { on: vi.fn() } }));
vi.mock("@main/utils/config", () => ({ getSongCacheDir: () => state.directory }));
vi.mock("@main/utils/logger", () => ({ songCacheLog: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("@main/store", () => ({
  store: { get: (key: string) => (key.endsWith("sizeLimitGb") ? state.limit : true) },
}));
vi.mock("@main/database/songCache", () => ({
  findByKey: (key: string) => state.rows.get(key),
  findByFilename: (filename: string) =>
    [...state.rows.values()].find((row) => row.filename === filename),
  upsert: (row: SongCacheRow) => state.rows.set(row.cacheKey, row),
  deleteByKey: (key: string) => state.rows.delete(key),
  clearAll: () => state.rows.clear(),
  touchLastUsed: vi.fn(),
  listAllFilenames: () => [...state.rows.values()].map((row) => row.filename),
  listLruVictims: (limit: number) => [...state.rows.values()].slice(0, limit),
  totalSize: () => [...state.rows.values()].reduce((sum, row) => sum + row.size, 0),
}));

/**
 * 构造供真实流写入流程使用的固定大小音频响应
 * @returns 带音频类型和长度声明的测试响应
 */
const audioResponse = (): Response =>
  new Response(Buffer.alloc(32, 1), {
    headers: { "content-type": "audio/wav", "content-length": "32" },
  });

describe("歌曲预载缓存生命周期", () => {
  beforeEach(async () => {
    vi.resetModules();
    state.rows.clear();
    state.directory = await fs.mkdtemp(path.join(os.tmpdir(), "splayer-cache-test-"));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(state.directory, { recursive: true, force: true });
  });

  it("取消预载消费者不会中断共用的后台下载", async () => {
    let finish!: (response: Response) => void;
    let signal!: AbortSignal;
    const fetcher = vi.fn((_url: string, options: RequestInit) => {
      signal = options.signal!;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const cache = await import("./songCache");
    const preload = cache.fetchAsync("same", "netease", "https://music/same", "preload");
    const background = cache.fetchAsync("same", "netease", "https://music/same");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    cache.cancelPreload("preload");
    expect(signal.aborted).toBe(false);
    finish(audioResponse());
    expect(await preload).toBe(await background);
    expect(await background).not.toBeNull();
  });

  it("取消排队的预载不会占用下载槽位或留下待执行任务", async () => {
    const finishes: Array<(response: Response) => void> = [];
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishes.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const cache = await import("./songCache");
    const first = cache.fetchAsync("first", "netease", "https://music/first");
    const second = cache.fetchAsync("second", "netease", "https://music/second");
    const queued = cache.fetchAsync("queued", "netease", "https://music/queued", "queued");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    cache.cancelPreload("queued");
    expect(await queued).toBeNull();
    finishes.splice(0).forEach((finish) => finish(audioResponse()));
    await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const next = cache.fetchAsync("next", "netease", "https://music/next");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    finishes[0]!(audioResponse());
    expect(await next).not.toBeNull();
  });

  it("取消唯一下载消费者会终止网络请求", async () => {
    const fetcher = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal!.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const cache = await import("./songCache");
    const preload = cache.fetchAsync("cancel", "netease", "https://music/cancel", "cancel");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    cache.cancelPreload("cancel");
    expect(await preload).toBeNull();
    expect(state.rows.size).toBe(0);
  });

  it("LRU 保留已准备的音源，释放租约后可以正常淘汰", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => audioResponse()),
    );
    const cache = await import("./songCache");
    const pinned = await cache.fetchAsync("pinned", "netease", "https://music/pinned", "next");
    await cache.fetchAsync("second", "netease", "https://music/second");
    await cache.fetchAsync("third", "netease", "https://music/third");
    expect(await fs.stat(pinned!)).toBeDefined();
    expect(state.rows.has("pinned")).toBe(true);
    expect(state.rows.has("second")).toBe(false);
    cache.cancelPreload("next");
    await cache.fetchAsync("fourth", "netease", "https://music/fourth");
    expect(state.rows.has("pinned")).toBe(false);
  });
});
