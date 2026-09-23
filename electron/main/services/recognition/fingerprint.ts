/**
 * 听歌识曲指纹计算入口：管理 AFP Worker 的创建与请求分发。
 */

import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { app } from "electron";
import { recognitionLog } from "@main/utils/logger";

interface FingerprintResponse {
  id: number;
  ok: boolean;
  fingerprint?: string;
  error?: string;
}

type FingerprintResult = { ok: true; fingerprint: string } | { ok: false; error: string };

/** 已加载的 worker 与请求队列 */
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (res: FingerprintResponse) => void>();

/** FingerprintResponse → FingerprintResult 归一化 */
const toResult = (res: FingerprintResponse): FingerprintResult =>
  res.ok
    ? { ok: true, fingerprint: res.fingerprint ?? "" }
    : { ok: false, error: res.error ?? "unknown" };

/** 解析 AFP 资产目录 */
const resolveAfpDir = (): string | null => {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, "afp")
    : path.join(app.getAppPath(), "resources", "afp");
  const files = ["afp.mjs", "afp.wasm.mjs"];
  return files.every((file) => fs.existsSync(path.join(dir, file))) ? dir : null;
};

const getWorker = (): Worker => {
  if (worker) return worker;
  const entry = path.join(__dirname, "fingerprint.worker.js");
  const next = new Worker(entry, {
    workerData: { afpDir: resolveAfpDir() },
  });
  next.on("message", (msg: FingerprintResponse) => {
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  });
  next.on("error", (error) => {
    recognitionLog.error("指纹 Worker 异常:", error);
    for (const resolve of pending.values()) {
      resolve({ id: 0, ok: false, error: error.message });
    }
    pending.clear();
    worker = null;
  });
  next.on("exit", () => {
    worker = null;
  });
  worker = next;
  return next;
};

/**
 * 计算音频指纹
 * @param pcm - 8 kHz 单声道样本
 * @returns 指纹字符串或错误信息（afp-unavailable 表示资产缺失）
 */
export const fingerprintPcm = (pcm: Float32Array): Promise<FingerprintResult> =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, (res) => resolve(toResult(res)));
    getWorker().postMessage({ id, pcm });
  });

/** AFP 资产是否可用（资产缺失时识别的指纹阶段无法进行） */
export const isAfpAvailable = (): boolean => {
  if (process.env.SPLAYER_AFP_FIXTURE === "1") return true;
  return resolveAfpDir() !== null;
};
