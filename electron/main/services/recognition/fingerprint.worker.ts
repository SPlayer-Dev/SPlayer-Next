//! 听歌识曲指纹 Worker：加载 AFP 指纹库（afp.js + afp.wasm），在主进程 Worker 线程计算指纹
//! 资产目录由主进程通过 workerData 传入；资产缺失时返回 afp-unavailable

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

interface FingerprintRequest {
  id: number;
  pcm: Float32Array;
}

interface FingerprintResponse {
  id: number;
  ok: boolean;
  fingerprint?: string;
  error?: string;
}

type AfpModule = { GenerateFP?: (pcm: Float32Array) => Promise<string> };

const afpDir = workerData?.afpDir as string | undefined;
const useFixture = process.env.SPLAYER_AFP_FIXTURE === "1";

let afpPromise: Promise<AfpModule | null> | null = null;

/** 加载 AFP ESM 指纹库 */
const loadAfp = (): Promise<AfpModule | null> => {
  if (afpPromise) return afpPromise;
  if (!afpDir) return Promise.resolve(null);
  const gluePath = path.join(afpDir, "afp.mjs");
  if (!fs.existsSync(gluePath)) return Promise.resolve(null);
  afpPromise = import(pathToFileURL(gluePath).href)
    .then((mod: AfpModule) => (typeof mod.GenerateFP === "function" ? mod : null))
    .catch(() => null);
  return afpPromise;
};

/** 兜底指纹：资产缺失且启用 fixture 时，用 PCM 的哈希生成确定性指纹用于流程联调 */
const fixtureFingerprint = (pcm: Float32Array): string => {
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(pcm.length / 256));
  for (let i = 0; i < pcm.length; i += step) {
    h ^= Math.round(pcm[i] * 32768);
    h = Math.imul(h, 0x01000193);
  }
  return `fixture-${(h >>> 0).toString(16).padStart(8, "0")}`;
};

parentPort?.on("message", async (request: FingerprintRequest) => {
  const respond = (res: FingerprintResponse): void => {
    parentPort?.postMessage(res);
  };
  const mod = await loadAfp();
  if (mod) {
    try {
      const fingerprint = await mod.GenerateFP!(request.pcm);
      respond({ id: request.id, ok: true, fingerprint });
      return;
    } catch (error) {
      respond({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }
  if (useFixture) {
    respond({ id: request.id, ok: true, fingerprint: fixtureFingerprint(request.pcm) });
    return;
  }
  respond({ id: request.id, ok: false, error: "afp-unavailable" });
});
