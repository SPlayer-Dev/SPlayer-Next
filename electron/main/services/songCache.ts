import fs from "node:fs";
import fsp, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app } from "electron";
import { store } from "@main/store";
import { getSongCacheDir } from "@main/utils/config";
import { songCacheLog } from "@main/utils/logger";
import type { TrackSource } from "@shared/types/player";
import {
  clearAll as dbClearAll,
  deleteByKey,
  findByFilename,
  findByKey,
  listAllFilenames,
  listLruVictims,
  totalSize,
  touchLastUsed,
  upsert,
} from "@main/database/songCache";

/** 下载并发上限 */
const MAX_CONCURRENT = 2;
/** 一批 LRU 淘汰数 */
const EVICT_BATCH = 8;

/**
 * 拒绝的响应 Content-Type 前缀（命中即不入缓存）
 * 第三方代理常用 200 包一段 HTML/JSON 错误体冒充音频，这里第一道拦截
 */
const REJECTED_MIME_PREFIXES = ["text/html", "application/json", "application/xml", "text/xml"];

const isRejectedMime = (mime: string | null): boolean => {
  if (!mime) return false;
  const lower = mime.toLowerCase();
  return REJECTED_MIME_PREFIXES.some((prefix) => lower.startsWith(prefix));
};

/**
 * 文件头是否像音频
 *
 * 反向看首字节，挡 HTML/JSON 错误页冒充音频的常见骗局。
 * 不做正向 magic 枚举（容器太多枚举不全反而漏判），剩余漏网坏文件由 player.ts:228
 * 的解码失败 invalidate 兜底
 */
const looksLikeAudio = async (filePath: string): Promise<boolean> => {
  let fd: FileHandle | null = null;
  try {
    fd = await fsp.open(filePath, "r");
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fd.read(buf, 0, 4, 0);
    if (bytesRead === 0) return false;
    // '<' = HTML/XML，'{' = JSON 对象，'[' = JSON 数组
    return buf[0] !== 0x3c && buf[0] !== 0x7b && buf[0] !== 0x5b;
  } catch {
    return false;
  } finally {
    if (fd) await fd.close().catch(() => {});
  }
};

interface InFlight {
  promise: Promise<string | null>;
  controller: AbortController;
}

/** 当前生效的歌曲缓存目录 */
let cacheDir = getSongCacheDir();
/** 进行中的下载，按 cacheKey 去重 */
const inFlight = new Map<string, InFlight>();
/** 等待槽位的队列；只存 starter，槽位空出来时取队头执行 */
const waiting: Array<() => void> = [];

/** sizeLimit 字节数；0/负数视为不限制 */
const sizeLimitBytes = (): number => {
  const gb = store.get("cache.songCache.sizeLimitGb") ?? 10;
  return gb > 0 ? gb * 1024 * 1024 * 1024 : Number.POSITIVE_INFINITY;
};

/** 是否启用歌曲缓存 */
const isCacheEnabled = (): boolean => store.get("cache.songCache.enabled") === true;

/**
 * 用 cache_key 派生唯一文件名
 * @param cacheKey - 缓存键
 * @returns 文件名
 */
const filenameFor = (cacheKey: string): string => {
  const hash = crypto.createHash("sha1").update(cacheKey).digest("hex").slice(0, 16);
  return `${hash}.bin`;
};

/** 获取文件的绝对路径
 * @param filename - 文件名
 * @returns 绝对路径
 */
const absPath = (filename: string): string => path.join(cacheDir, filename);

/**
 * 占一个并发槽位
 * @returns
 */
const acquireSlot = async (): Promise<void> => {
  if (inFlight.size < MAX_CONCURRENT) return;
  await new Promise<void>((resolve) => waiting.push(resolve));
};

/**
 * 释放槽位并唤醒一个等待者
 * @returns
 */
const releaseSlot = (): void => {
  const next = waiting.shift();
  if (next) next();
};

/**
 * 启动时孤儿清理
 * 删 .part；删表里有文件不在的；删目录里有表里没的
 */
const cleanupOrphans = async (): Promise<void> => {
  let entries: string[];
  try {
    entries = await fsp.readdir(cacheDir);
  } catch {
    return;
  }

  let partRemoved = 0;
  let orphanFiles = 0;
  for (const name of entries) {
    if (name.endsWith(".part")) {
      try {
        await fsp.unlink(path.join(cacheDir, name));
        partRemoved += 1;
      } catch {}
    }
  }

  const known = new Set(listAllFilenames());
  for (const name of entries) {
    if (name.endsWith(".part")) continue;
    if (!known.has(name)) {
      try {
        await fsp.unlink(path.join(cacheDir, name));
        orphanFiles += 1;
      } catch {}
    }
  }

  let missingRows = 0;
  for (const filename of known) {
    if (!fs.existsSync(path.join(cacheDir, filename))) {
      const row = findByFilename(filename);
      if (row) deleteByKey(row.cacheKey);
      missingRows += 1;
    }
  }

  songCacheLog.info(
    `[init] dir=${cacheDir} orphans.part=${partRemoved} orphan-files=${orphanFiles} missing-rows=${missingRows}`,
  );
};

/**
 * LRU 淘汰：超过 cap 时按 last_used_at 升序批量删
 * - 删超过 cap 的
 * - 删表里有文件不在的
 * - 删目录里有表里没的
 */
const evictIfNeeded = async (): Promise<void> => {
  const cap = sizeLimitBytes();
  let current = totalSize();
  if (current <= cap) return;

  let evicted = 0;
  let freed = 0;
  while (current > cap) {
    const victims = listLruVictims(EVICT_BATCH);
    if (victims.length === 0) break;
    for (const victim of victims) {
      try {
        await fsp.unlink(absPath(victim.filename));
      } catch {}
      deleteByKey(victim.cacheKey);
      current -= victim.size;
      freed += victim.size;
      evicted += 1;
    }
  }
  if (evicted > 0) songCacheLog.info(`[evict] count=${evicted} freed=${freed}`);
};

/**
 * 实际下载实现
 * @param cacheKey - 缓存键
 * @param source - 来源
 * @param streamUrl - 流 URL
 * @param controller - 控制器
 * @returns 文件路径
 */
const runDownload = async (
  cacheKey: string,
  source: TrackSource,
  streamUrl: string,
  controller: AbortController,
): Promise<string | null> => {
  const start = Date.now();
  const filename = filenameFor(cacheKey);
  const finalPath = absPath(filename);
  const partPath = `${finalPath}.part`;

  try {
    await fsp.mkdir(cacheDir, { recursive: true });
    const response = await fetch(streamUrl, { signal: controller.signal });
    if (!response.ok || !response.body) {
      songCacheLog.warn(`[fetch] fail key=${cacheKey} status=${response.status}`);
      return null;
    }

    const mime = response.headers.get("content-type");
    // 拦截第三方代理常用 200+html 错误页冒充音频
    if (isRejectedMime(mime)) {
      songCacheLog.warn(`[fetch] reject mime key=${cacheKey} mime=${mime}`);
      return null;
    }
    const contentLengthHeader = response.headers.get("content-length");
    const declaredSize = contentLengthHeader ? Number(contentLengthHeader) : NaN;
    if (Number.isFinite(declaredSize) && declaredSize > sizeLimitBytes()) {
      songCacheLog.warn(`[fetch] skip oversize key=${cacheKey} declared=${declaredSize}`);
      return null;
    }

    const nodeStream = Readable.fromWeb(response.body as never);
    const writeStream = fs.createWriteStream(partPath);
    await pipeline(nodeStream, writeStream);

    const stat = await fsp.stat(partPath);
    if (stat.size === 0) {
      await fsp.unlink(partPath).catch(() => {});
      songCacheLog.warn(`[fetch] empty key=${cacheKey}`);
      return null;
    }
    if (stat.size > sizeLimitBytes()) {
      await fsp.unlink(partPath).catch(() => {});
      songCacheLog.warn(`[fetch] post oversize key=${cacheKey} actual=${stat.size}`);
      return null;
    }
    // 拦截首字节看着像音频才放行
    if (!(await looksLikeAudio(partPath))) {
      await fsp.unlink(partPath).catch(() => {});
      songCacheLog.warn(`[fetch] not audio key=${cacheKey} mime=${mime} size=${stat.size}`);
      return null;
    }

    await fsp.rename(partPath, finalPath);
    const now = Date.now();
    upsert({
      cacheKey,
      source,
      filename,
      size: stat.size,
      mime,
      cachedAt: now,
      lastUsedAt: now,
    });
    await evictIfNeeded();

    songCacheLog.info(`[fetch] done key=${cacheKey} size=${stat.size} ms=${Date.now() - start}`);
    return finalPath;
  } catch (err) {
    await fsp.unlink(partPath).catch(() => {});
    if (controller.signal.aborted) {
      songCacheLog.info(`[fetch] cancel key=${cacheKey}`);
    } else {
      songCacheLog.error(`[fetch] error key=${cacheKey}`, err);
    }
    return null;
  }
};

/** 启动初始化：建目录 + 孤儿清理 */
export const init = async (): Promise<void> => {
  cacheDir = getSongCacheDir();
  await fsp.mkdir(cacheDir, { recursive: true });
  await cleanupOrphans();
  app.on("before-quit", () => {
    for (const entry of inFlight.values()) entry.controller.abort();
  });
};

/** 切换缓存目录后调用，让服务感知新前缀 */
export const reloadDir = (): void => {
  cacheDir = getSongCacheDir();
};

/** 查询命中；命中则更新 last_used_at 并返回本地绝对路径 */
export const lookup = async (cacheKey: string): Promise<string | null> => {
  if (!isCacheEnabled()) return null;
  const row = findByKey(cacheKey);
  if (!row) return null;
  const full = absPath(row.filename);
  if (!fs.existsSync(full)) {
    deleteByKey(cacheKey);
    return null;
  }
  touchLastUsed(cacheKey, Date.now());
  return full;
};

/**
 * 异步排队下载
 * @param cacheKey - 缓存键
 * @param source - 来源
 * @param streamUrl - 流 URL
 * @returns 文件路径
 */
export const fetchAsync = (
  cacheKey: string,
  source: TrackSource,
  streamUrl: string,
): Promise<string | null> => {
  if (!isCacheEnabled()) return Promise.resolve(null);
  const existing = inFlight.get(cacheKey);
  if (existing) return existing.promise;

  const controller = new AbortController();
  const promise = (async () => {
    await acquireSlot();
    try {
      return await runDownload(cacheKey, source, streamUrl, controller);
    } finally {
      inFlight.delete(cacheKey);
      releaseSlot();
    }
  })();
  inFlight.set(cacheKey, { promise, controller });
  return promise;
};

/**
 * 取消正在进行的下载
 * @param cacheKey - 缓存键
 */
export const cancel = (cacheKey: string): void => {
  const entry = inFlight.get(cacheKey);
  if (entry) entry.controller.abort();
};

/**
 * 失效：删文件 + 删表
 * 如果表里没有或文件不存在则静默返回
 * @param sourcePath - 传入原始来源路径（streamUrl 或本地路径），用来找到对应的 cacheKey 和文件
 */
export const invalidate = async (sourcePath: string): Promise<void> => {
  const filename = path.basename(sourcePath);
  const row = findByFilename(filename);
  if (!row) return;
  deleteByKey(row.cacheKey);
  await fsp.unlink(absPath(filename)).catch(() => {});
  songCacheLog.info(`[invalidate] path=${sourcePath}`);
};

/** 清空全部 */
export const clearAll = async (): Promise<void> => {
  for (const entry of inFlight.values()) entry.controller.abort();
  inFlight.clear();
  dbClearAll();
  try {
    const entries = await fsp.readdir(cacheDir);
    await Promise.all(entries.map((name) => fsp.unlink(path.join(cacheDir, name)).catch(() => {})));
  } catch {}
  songCacheLog.info("[clearAll] done");
};

/** 占用统计 */
export const stats = (): { size: number; path: string } => ({
  size: totalSize(),
  path: cacheDir,
});
