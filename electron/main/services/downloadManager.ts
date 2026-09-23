/**
 * 下载管理服务
 *
 * 渲染层构建好请求后交给本服务：整批入队、串行下载，轮到某任务且
 * 缺少 URL 时经 download:resolve 向渲染层即时索取
 */

import fs from "node:fs";
import fsp, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { app } from "electron";
import { store } from "@main/store";
import { getDownloadDir, getCoverCacheDir, getAppCacheDir } from "@main/utils/config";
import { broadcast } from "@main/utils/broadcast";
import { downloadLog } from "@main/utils/logger";
import { getEngine } from "@main/services/engine";
import { fetchBytes } from "@main/utils/fetchBytes";
import { renderDownloadPath, dedupePath, resolveExtension } from "@main/utils/filename";
import * as db from "@main/database/downloads";
import { ErrorCode } from "@shared/types/errors";
import type { JsTagWriteRequest } from "@splayer/audio-engine";
import type {
  DownloadRequest,
  DownloadResolvePayload,
  DownloadResolution,
  DownloadTask,
  EnqueueResult,
} from "@shared/types/download";

/** 进度推送节流间隔 */
const PROGRESS_INTERVAL_MS = 250;
/** 拒绝的响应 Content-Type 前缀（命中即非音频） */
const REJECTED_MIME_PREFIXES = ["text/html", "application/json", "application/xml", "text/xml"];

/** 是否拒绝的 MIME 类型 */
const isRejectedMime = (mime: string | null): boolean =>
  !!mime && REJECTED_MIME_PREFIXES.some((prefix) => mime.toLowerCase().startsWith(prefix));

/** 首字节是否像音频 */
const looksLikeAudio = async (filePath: string): Promise<boolean> => {
  let fd: FileHandle | null = null;
  try {
    fd = await fsp.open(filePath, "r");
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fd.read(buf, 0, 4, 0);
    if (bytesRead === 0) return false;
    return buf[0] !== 0x3c && buf[0] !== 0x7b && buf[0] !== 0x5b;
  } catch {
    return false;
  } finally {
    if (fd) await fd.close().catch(() => {});
  }
};

interface Pending {
  req: DownloadRequest;
  task: DownloadTask;
  controller: AbortController;
  dedupeKey: string;
  /** 已被删除：收尾的状态广播应被丢弃，避免删行后又被写回 */
  removed?: boolean;
}

/** 全部未结束任务（排队中 + 进行中），按 taskId */
const tasks = new Map<string, Pending>();
/** 等待下载的 taskId，FIFO */
const queue: string[] = [];
/** 当前正在下载的 taskId；null 表示空闲 */
let active: string | null = null;

/** 渲染层解析结果的等待门 */
interface ResolutionGate {
  resolve: (res: DownloadResolution) => void;
  reject: (err: Error) => void;
}

/** 轮到下载但缺 URL 的任务，按 taskId 等待渲染层回传解析 */
const resolutionGates = new Map<string, ResolutionGate>();

/** 临时分片目录（与用户下载目录隔离） */
const tmpDir = (): string => path.join(getAppCacheDir(), "downloads-tmp");

/** 去重键：同一首歌同一档位只下一次 */
const dedupeKeyOf = (req: DownloadRequest): string =>
  `${req.track.source}:${req.track.id}:${req.qualityLevel}`;

/** 合并艺术家名 */
const artistString = (req: DownloadRequest): string =>
  req.track.artists.map((artist) => artist.name).join("/");

/** 广播任务状态 */
const broadcastState = (task: DownloadTask): void => {
  // 已删除的任务：收尾态（如中断产生的 canceled）不再写回 DB / 推送，否则会在删行后复活
  if (tasks.get(task.taskId)?.removed) return;
  db.upsert(task);
  broadcast("download:state", task);
};

/** 跨盘安全移动 */
const moveFile = async (src: string, dest: string): Promise<void> => {
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    } else {
      throw err;
    }
  }
};

/**
 * 把流写到临时文件并按节流推进度
 * @returns 已接收字节数
 */
const streamToFile = async (
  body: ReadableStream<Uint8Array>,
  partPath: string,
  taskId: string,
  total: number,
  signal: AbortSignal,
): Promise<number> => {
  const reader = body.getReader();
  let received = 0;
  let lastTs = 0;
  // 交给 pipeline 管理写入流
  const source = (async function* read() {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        received += value.length;
        const now = Date.now();
        if (now - lastTs >= PROGRESS_INTERVAL_MS) {
          lastTs = now;
          broadcast("download:progress", { taskId, received, total }, true);
        }
        yield value;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  })();
  await pipeline(source, fs.createWriteStream(partPath), { signal });
  return received;
};

/** 写入标签（封面/元信息/歌词）；失败返回 false 但不影响音频文件 */
const applyTags = async (req: DownloadRequest, filePath: string): Promise<boolean> => {
  const { tagOptions } = req;
  const writeRequest: JsTagWriteRequest = { path: filePath };
  let hasWrite = false;
  if (tagOptions.embedMeta) {
    writeRequest.title = req.track.title;
    writeRequest.artist = artistString(req);
    if (req.track.album?.name) writeRequest.album = req.track.album.name;
    hasWrite = true;
  }
  if (tagOptions.embedLyric && req.lyricText) {
    writeRequest.lyrics = req.lyricText;
    hasWrite = true;
  }
  if (tagOptions.embedCover && req.coverUrl) {
    const cover = await fetchBytes(req.coverUrl, { requireImage: true });
    if (cover) {
      writeRequest.cover = cover;
      hasWrite = true;
    } else {
      downloadLog.warn(`封面下载失败，跳过封面: ${req.coverUrl}`);
    }
  }
  if (!hasWrite) return true;
  try {
    const results = await getEngine().writeTrackTags([writeRequest], getCoverCacheDir());
    return results[0]?.success === true;
  } catch (err) {
    downloadLog.warn(`写标签失败 ${filePath}:`, err);
    return false;
  }
};

/** 写同名歌词文件，失败仅告警不影响音频 */
const writeSidecar = async (filePath: string, text: string): Promise<void> => {
  try {
    await fsp.writeFile(filePath, text, "utf-8");
  } catch (err) {
    downloadLog.warn(`写歌词文件失败 ${filePath}:`, err);
  }
};

/** 按开关写 .lrc（所选格式）与 .ttml（完整） */
const writeLyricFiles = async (req: DownloadRequest, audioPath: string): Promise<void> => {
  const base = audioPath.slice(0, audioPath.length - path.extname(audioPath).length);
  if (req.tagOptions.writeLrc && req.lyricText) await writeSidecar(`${base}.lrc`, req.lyricText);
  if (req.tagOptions.saveTtml && req.ttmlText) await writeSidecar(`${base}.ttml`, req.ttmlText);
};

/** 等待渲染层补全解析；任务被取消/删除时经中断信号立即拒绝 */
const waitForResolution = (taskId: string, signal: AbortSignal): Promise<DownloadResolution> =>
  new Promise((resolve, reject) => {
    const onAbort = (): void => {
      resolutionGates.delete(taskId);
      reject(new Error("resolution aborted"));
    };
    const gate: ResolutionGate = {
      resolve: (res) => {
        resolutionGates.delete(taskId);
        signal.removeEventListener("abort", onAbort);
        resolve(res);
      },
      reject: (err) => {
        resolutionGates.delete(taskId);
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    };
    resolutionGates.set(taskId, gate);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });

/** 渲染层回传解析结果 */
export const submitResolution = (taskId: string, res: DownloadResolution): void => {
  resolutionGates.get(taskId)?.resolve(res);
};

/** 渲染层解析失败，任务按失败收尾 */
export const failResolution = (taskId: string): void => {
  resolutionGates.get(taskId)?.reject(new Error("resolve failed"));
};

/** 实际下载 + 落盘 + 写标签 */
const runTask = async (
  req: DownloadRequest,
  task: DownloadTask,
  controller: AbortController,
): Promise<void> => {
  const partPath = path.join(tmpDir(), `${req.taskId}.part`);

  try {
    // 轮到才向渲染层即时解析
    if (!req.url) {
      const payload: DownloadResolvePayload = {
        taskId: req.taskId,
        track: req.track,
        qualityLevel: req.qualityLevel,
        tagOptions: req.tagOptions,
        coverUrl: req.coverUrl,
        usePlaybackForDownload: req.usePlaybackForDownload,
        lyricFileFormat: req.lyricFileFormat,
      };
      const resolution = waitForResolution(req.taskId, controller.signal);
      broadcast("download:resolve", payload);
      Object.assign(req, await resolution);
    }
    const audioUrl = req.url;
    if (!audioUrl) throw new Error("missing download url");

    const downloadDir = getDownloadDir();
    const { relDir, baseName } = renderDownloadPath(
      store.get("download.folderScheme"),
      store.get("download.fileTemplate"),
      {
        artist: artistString(req),
        title: req.track.title,
        album: req.track.album?.name ?? "",
      },
    );
    const targetDir = path.join(downloadDir, relDir);
    const finalNoExt = path.join(targetDir, baseName);
    const policy = store.get("download.overwritePolicy");

    // skip 策略：用预估扩展名提前命中已存在文件则跳过
    const guessExt = resolveExtension(req.declaredFormat, null, audioUrl);
    if (policy === "skip" && fs.existsSync(`${finalNoExt}${guessExt}`)) {
      task.status = "done";
      task.filePath = `${finalNoExt}${guessExt}`;
      task.finishedAt = Date.now();
      broadcastState(task);
      return;
    }

    await fsp.mkdir(tmpDir(), { recursive: true });
    await fsp.mkdir(targetDir, { recursive: true });

    const response = await fetch(audioUrl, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }
    const mime = response.headers.get("content-type");
    if (isRejectedMime(mime)) throw new Error(`rejected mime ${mime}`);
    const total = Number(response.headers.get("content-length")) || req.declaredSize || 0;

    const received = await streamToFile(
      response.body as ReadableStream<Uint8Array>,
      partPath,
      req.taskId,
      total,
      controller.signal,
    );
    if (received === 0) throw new Error("empty body");
    if (!(await looksLikeAudio(partPath))) throw new Error("not audio");

    const ext = resolveExtension(req.declaredFormat, mime, audioUrl);
    const finalPath = policy === "rename" ? dedupePath(finalNoExt, ext) : `${finalNoExt}${ext}`;
    await moveFile(partPath, finalPath);

    await writeLyricFiles(req, finalPath);
    const tagOk = await applyTags(req, finalPath);

    task.status = "done";
    task.received = received;
    task.total = total || received;
    task.filePath = finalPath;
    task.tagWarning = !tagOk;
    task.finishedAt = Date.now();
    broadcastState(task);
    downloadLog.info(`完成 ${req.track.title} → ${finalPath}`);
  } catch (err) {
    await fsp.unlink(partPath).catch(() => {});
    if (controller.signal.aborted) {
      task.status = "canceled";
    } else {
      task.status = "failed";
      task.errorCode = ErrorCode.UNKNOWN;
      downloadLog.error(`失败 ${req.track.title}:`, err);
    }
    task.finishedAt = Date.now();
    broadcastState(task);
  }
};

/** 串行处理队列：一次只下一首，下完再取下一个 */
const pump = async (): Promise<void> => {
  if (active !== null) return;
  const taskId = queue.shift();
  if (taskId === undefined) return;
  const pending = tasks.get(taskId);
  if (!pending) return void pump();
  active = taskId;
  pending.task.status = "downloading";
  broadcastState(pending.task);
  try {
    await runTask(pending.req, pending.task, pending.controller);
  } finally {
    tasks.delete(taskId);
    active = null;
    void pump();
  }
};

/** 入队下载（start / retry 共用，按 taskId 覆盖任务行） */
const enqueueOne = (
  req: DownloadRequest,
  completedByQuality?: Map<string, DownloadTask[]>,
): EnqueueResult => {
  if (tasks.has(req.taskId)) return { ok: false, reason: "queued" };
  const dedupeKey = dedupeKeyOf(req);
  for (const pending of tasks.values()) {
    if (pending.dedupeKey === dedupeKey) return { ok: false, reason: "queued" };
  }
  // 已下载过同曲同音质且文件仍在 → 拦下
  let completed = completedByQuality?.get(req.qualityLevel);
  if (!completed) {
    completed = db.listCompletedByQuality(req.qualityLevel);
    completedByQuality?.set(req.qualityLevel, completed);
  }
  const downloaded = completed.find(
    (task) => task.track.source === req.track.source && task.track.id === req.track.id,
  );
  if (downloaded?.filePath && fs.existsSync(downloaded.filePath)) {
    return { ok: false, reason: "downloaded" };
  }
  const task: DownloadTask = {
    taskId: req.taskId,
    status: "queued",
    track: req.track,
    qualityLevel: req.qualityLevel,
    received: 0,
    total: req.declaredSize ?? 0,
    createdAt: Date.now(),
  };
  tasks.set(req.taskId, { req, task, controller: new AbortController(), dedupeKey });
  queue.push(req.taskId);
  broadcastState(task);
  void pump();
  return { ok: true };
};

export const enqueue = (req: DownloadRequest): EnqueueResult => enqueueOne(req);

/** 批量入队：同一音质只读取一次已完成历史 */
export const enqueueMany = (reqs: DownloadRequest[]): EnqueueResult[] => {
  const completedByQuality = new Map<string, DownloadTask[]>();
  return reqs.map((req) => enqueueOne(req, completedByQuality));
};

/** 取消任务：进行中则中断，排队中则移出并置为已取消 */
export const cancel = (taskId: string): void => {
  const pending = tasks.get(taskId);
  if (!pending) return;
  if (active === taskId) {
    pending.controller.abort();
    return;
  }
  const idx = queue.indexOf(taskId);
  if (idx !== -1) queue.splice(idx, 1);
  tasks.delete(taskId);
  pending.task.status = "canceled";
  pending.task.finishedAt = Date.now();
  broadcastState(pending.task);
};

/** 下载附带的歌词文件可能的扩展名 */
const LYRIC_SIDECAR_EXTS = [".lrc", ".qrc", ".yrc", ".krc", ".ttml", ".lys"];

/**
 * 删除已下载的音频文件及同名歌词文件
 * @param filePath 音频文件路径
 */
const deleteDownloadedFile = async (filePath: string): Promise<void> => {
  await fsp.unlink(filePath).catch(() => {});
  const base = filePath.slice(0, filePath.length - path.extname(filePath).length);
  await Promise.all(LYRIC_SIDECAR_EXTS.map((ext) => fsp.unlink(`${base}${ext}`).catch(() => {})));
};

/**
 * 删除一条任务记录
 * @param taskId 任务 ID
 */
export const remove = (taskId: string): void => {
  const pending = tasks.get(taskId);
  if (pending) {
    pending.removed = true;
    if (active === taskId) {
      // 进行中：中断即可，收尾的 canceled 广播会被 removed 守卫拦掉，行随后由 db.remove 删除
      pending.controller.abort();
    } else {
      const idx = queue.indexOf(taskId);
      if (idx !== -1) queue.splice(idx, 1);
      tasks.delete(taskId);
    }
  }
  const filePath = db.findById(taskId)?.filePath;
  db.remove(taskId);
  if (filePath) void deleteDownloadedFile(filePath);
};

/** 清空已结束任务 */
export const clearFinished = (): void => db.clearFinished();

/** 列出全部任务 */
export const list = (): DownloadTask[] => db.listAll();

/** 启动初始化 */
export const init = async (): Promise<void> => {
  db.markInterrupted();
  const dir = tmpDir();
  try {
    const entries = await fsp.readdir(dir);
    await Promise.all(entries.map((name) => fsp.unlink(path.join(dir, name)).catch(() => {})));
  } catch {}
  app.on("before-quit", () => {
    for (const pending of tasks.values()) pending.controller.abort();
  });
};
