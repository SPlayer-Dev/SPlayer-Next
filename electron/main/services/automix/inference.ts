import { spawn } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import { playerLog } from "@main/utils/logger";
import { automixDirs } from "@main/utils/paths";
import { AUTOMIX_WORKER } from "./assets";

let pending: Promise<unknown> = Promise.resolve();
const shutdown = new AbortController();
app.once("before-quit", () => shutdown.abort());

/**
 * 顺序运行模型任务，旧进程退出前不启动下一次分析
 * @param signal - 当前预载代次的取消信号
 * @param task - 包含输入导出和进程关闭的完整任务
 * @returns 当前任务的结果，排队期间取消时直接拒绝
 */
export const runAutoMixTask = <T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> => {
  const result = pending.then(() => {
    shutdown.signal.throwIfAborted();
    signal.throwIfAborted();
    return task();
  });
  pending = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

/**
 * 在独立分析进程推理有限窗口，关闭后才归还任务所有权和模型内存
 * @param kind - 节拍或声部分离模型
 * @param windows - 本次任务的临时输入输出文件
 * @param signal - 当前预载代次的取消信号
 * @returns 每个窗口的紧凑元数据，音频和预测张量通过临时文件传递
 */
export const runAutoMixModel = <T>(
  kind: "beat" | "demucs",
  windows: { input: string; output: string }[],
  signal: AbortSignal,
): Promise<T[]> =>
  new Promise((resolve, reject) => {
    const combined = AbortSignal.any([signal, shutdown.signal]);
    if (combined.aborted) {
      reject(combined.reason);
      return;
    }
    const child = spawn(path.join(automixDirs.runtime, AUTOMIX_WORKER), [], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    child.once("error", (error) => {
      failure ??= error;
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      combined.removeEventListener("abort", abort);
      const error =
        failure ?? (code === 0 ? undefined : new Error(stderr || `AutoMix exited: ${code}`));
      if (error) reject(error);
      else {
        try {
          const result = JSON.parse(stdout) as {
            windows: T[];
            memoryMb: number;
            seconds: number;
            backend: "DirectML" | "CPU";
          };
          if (result.windows.length !== windows.length) throw new Error("分析窗口数量不匹配");
          playerLog.info(kind === "beat" ? "AutoMix 节拍分析完成" : "AutoMix 声部分离完成", {
            memoryMb: result.memoryMb,
            seconds: Math.round(result.seconds * 1000) / 1000,
            backend: result.backend,
          });
          resolve(result.windows);
        } catch (reason) {
          reject(reason);
        }
      }
    });
    /**
     * 等待子进程关闭文件后再结算，防止取消后继续占用 Windows 临时文件
     * @param error - 取消或终止原因
     */
    const stop = (error: Error): void => {
      failure ??= error;
      child.kill();
    };
    /** 取消当前预载对应的模型进程 */
    const abort = (): void => stop(new Error("AutoMix 分析已取消"));
    const timer = setTimeout(() => stop(new Error("AutoMix 分析超时")), 120_000);
    combined.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += String(chunk);
      if (stdout.length > 256_000) stop(new Error("AutoMix 分析输出超出限制"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + String(chunk)).slice(-8192);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(
      JSON.stringify({
        kind,
        model: path.join(automixDirs[kind], kind === "beat" ? "beat-this.onnx" : "htdemucs.onnx"),
        windows,
      }),
    );
  });
