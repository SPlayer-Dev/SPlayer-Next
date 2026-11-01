import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { net } from "electron";
import { broadcast } from "@main/utils/broadcast";
import { playerLog } from "@main/utils/logger";
import { automixDirs } from "@main/utils/paths";
import type {
  AutoMixComponentId,
  AutoMixComponentStatus,
  AutoMixModelStatus,
} from "@shared/types/automix";
import { AUTOMIX_COMPONENTS, AUTOMIX_MIRRORS, AUTOMIX_WORKER } from "./assets";
import { extractAutoMixPackage } from "./runtime";

const models: AutoMixModelStatus[] = (["beat", "demucs", "runtime"] as const).map((id) => ({
  id,
  state: AUTOMIX_COMPONENTS[id] ? "missing" : "unsupported",
  received: 0,
  total: 0,
}));
let checking: Promise<AutoMixComponentStatus> | undefined;
let installation: Promise<AutoMixComponentStatus> | undefined;
let controller: AbortController | undefined;
let activeComponentId: AutoMixComponentId | undefined;

/** 汇总独立组件的紧凑状态，不包含模型或音频数据 */
const snapshot = (): AutoMixComponentStatus => ({
  state: models.every((model) => model.state === "ready")
    ? "ready"
    : models.some((model) => model.state === "downloading")
      ? "downloading"
      : models.some((model) => model.state === "error")
        ? "error"
        : "missing",
  models: models.map((item) => ({ ...item })),
});

/**
 * 每次查询都重新检查所需文件，用户手动删除组件后立即反映，并发查询共享结果
 * @returns 组件的安装或下载状态
 */
export const getAutoMixComponentStatus = (): Promise<AutoMixComponentStatus> => {
  if (installation) return Promise.resolve(snapshot());
  if (checking) return checking;
  checking = (async () => {
    for (const model of models) {
      const asset = AUTOMIX_COMPONENTS[model.id];
      if (!asset) continue;
      const files = await Promise.all(
        asset.files.map((file) => stat(path.join(automixDirs[model.id], file)).catch(() => null)),
      );
      model.state = files.every((file) => file?.isFile() && file.size > 0) ? "ready" : "missing";
    }
    return snapshot();
  })().finally(() => {
    checking = undefined;
  });
  return checking;
};

/**
 * 用户点击后流式下载并解压组件，完成后移动到安装目录
 * @param id - 组件标识
 * @returns 安装完成或失败后的组件状态
 */
export const installAutoMixComponents = (
  id: AutoMixComponentId,
): Promise<AutoMixComponentStatus> => {
  if (installation)
    return activeComponentId === id
      ? installation
      : Promise.reject(new Error("请等待当前组件安装完成"));
  const model = models.find((item) => item.id === id);
  const asset = AUTOMIX_COMPONENTS[id];
  if (!model || !asset) return Promise.reject(new Error("不支持的 AutoMix 组件"));
  controller = new AbortController();
  activeComponentId = id;
  const signal = controller.signal;
  installation = (async () => {
    const staging = automixDirs[id] + ".part";
    try {
      await getAutoMixComponentStatus();
      if (model.state === "ready") return snapshot();
      model.state = "downloading";
      model.received = 0;
      model.total = 0;
      model.error = undefined;
      broadcast("automix:componentStatus", snapshot());
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      const archive = path.join(staging, asset.file);
      model.total = asset.bytes;
      let failure: unknown;
      for (const mirror of AUTOMIX_MIRRORS) {
        try {
          model.received = 0;
          const response = await net.fetch(mirror + asset.file, { signal });
          if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
          const body = response.body;
          const hash = createHash("sha256");
          const startedAt = performance.now();
          let announcedAt = 0;
          const source = (async function* () {
            for await (const chunk of body) {
              hash.update(chunk);
              model.received += chunk.byteLength;
              // 镜像返回的内容不可信，超过发布包大小立即中断，避免写满磁盘
              if (model.received > asset.bytes) throw new Error("组件大小超出发布包");
              if (performance.now() - announcedAt >= 200) {
                announcedAt = performance.now();
                model.bytesPerSecond = Math.round(
                  (model.received * 1000) / Math.max(1, announcedAt - startedAt),
                );
                broadcast("automix:componentStatus", snapshot(), true);
              }
              yield chunk;
            }
          })();
          await pipeline(source, createWriteStream(archive), { signal });
          if (hash.digest("hex") !== asset.sha256) throw new Error("组件校验失败");
          failure = undefined;
          break;
        } catch (error) {
          signal.throwIfAborted();
          failure = error;
          playerLog.warn(`AutoMix 组件下载失败: ${mirror}`, error);
        }
      }
      if (failure) throw failure;
      await extractAutoMixPackage(archive, staging, signal);
      await rm(archive);
      for (const file of asset.files) {
        const info = await stat(path.join(staging, file));
        if (!info.isFile() || !info.size) throw new Error(`组件文件缺失: ${file}`);
      }
      if (id === "runtime" && process.platform !== "win32")
        await chmod(path.join(staging, AUTOMIX_WORKER), 0o755);
      signal.throwIfAborted();
      const destination = automixDirs[id];
      await rm(destination, { recursive: true, force: true });
      // Windows 刚解压的运行库可能短暂被占用，只重试目录移动且允许取消
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        try {
          await rename(staging, destination);
          break;
        } catch (error) {
          if (
            process.platform !== "win32" ||
            !["EPERM", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "") ||
            attempt === 5
          )
            throw error;
          await delay(250 * (attempt + 1), undefined, { signal });
        }
      }
      model.state = "ready";
    } catch (error) {
      if (signal.aborted) {
        model.state = "missing";
        model.error = undefined;
      } else {
        model.state = "error";
        model.error = error instanceof Error ? error.message : String(error);
        playerLog.warn("AutoMix 组件安装失败", error);
      }
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      installation = undefined;
      controller = undefined;
      activeComponentId = undefined;
      model.bytesPerSecond = undefined;
      broadcast("automix:componentStatus", snapshot());
    }
    return snapshot();
  })();
  return installation;
};

/** 取消下载并在安装任务结束时清理临时文件 */
export const cancelAutoMixDownload = (): void => controller?.abort();
