/**
 * 插件沙箱（主进程侧）
 *
 * 封装 utilityProcess.fork，负责：
 * - 启动/停止/重启子进程
 * - 发送 init 并等待 ready
 * - 转发 call / cancel / hostResult
 * - 心跳检测卡死
 * - 向上派发事件（ready/result/hostCall/log/fatal/exit）
 */

import path from "node:path";
import { utilityProcess, type UtilityProcess, app } from "electron";
import type {
  HostCallMethod,
  PluginAction,
  PluginErrorPayload,
  PluginManifest,
  PluginUpdateInfo,
  SandboxIn,
  SandboxOut,
  SourceCapability,
} from "@shared/types/plugin";
import {
  HEARTBEAT_INTERVAL,
  HEARTBEAT_MAX_MISSES,
  PLUGIN_LOAD_TIMEOUT,
  PluginErrorCodes,
} from "@shared/defaults/plugin-api";

export interface SandboxEvents {
  onReady: (sources: Record<string, SourceCapability>) => void;
  onResult: (requestId: string, ok: boolean, data?: unknown, error?: PluginErrorPayload) => void;
  onHostCall: (callId: string, method: HostCallMethod, args: unknown[]) => void;
  onLog: (level: "debug" | "info" | "warn" | "error", args: unknown[]) => void;
  onFatal: (error: PluginErrorPayload) => void;
  /** 脚本上报"有新版本" */
  onUpdateAvailable: (info: PluginUpdateInfo) => void;
  /** 子进程退出（可能是崩溃或主动 kill）。isCrash=true 表示非主动 kill */
  onExit: (isCrash: boolean, code: number | null) => void;
}

export interface SandboxStartOptions {
  manifest: PluginManifest;
  /** 插件脚本源码（已解压并去除 gz_ 前缀） */
  source: string;
  /** 用户为此插件保存的设置（setting key → value） */
  userSettings: Record<string, unknown>;
  /** 主进程当前 locale，透传给插件 */
  locale: string;
}

/** utilityProcess 入口脚本的绝对路径 */
const resolveWorkerEntry = (): string => {
  // 开发：由 electron-vite 输出到 out/main/sandbox.worker.js
  // 生产：app.asar 解压后同样在 out/main/
  const appPath = app.getAppPath();
  return path.join(appPath, "out", "main", "sandbox.worker.js");
};

export class Sandbox {
  private child: UtilityProcess | null = null;
  private ready = false;
  private disposed = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatMisses = 0;
  private intentionalKill = false;

  constructor(
    private readonly opts: SandboxStartOptions,
    private readonly events: SandboxEvents,
  ) {}

  /** 启动子进程并等待 ready。超时或 fatal 时 reject */
  start(): Promise<Record<string, SourceCapability>> {
    if (this.child) return Promise.reject(new Error("sandbox already started"));
    const entry = resolveWorkerEntry();
    this.child = utilityProcess.fork(entry, [], {
      serviceName: `splayer-plugin-${this.opts.manifest.id}`,
      stdio: "pipe",
    });

    return new Promise((resolve, reject) => {
      let settled = false;

      const done = (err: Error | null, sources?: Record<string, SourceCapability>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(loadTimer);
        if (err) reject(err);
        else {
          this.ready = true;
          this.startHeartbeat();
          resolve(sources ?? {});
        }
      };

      const loadTimer = setTimeout(() => {
        done(
          Object.assign(new Error("plugin load timeout"), {
            code: PluginErrorCodes.LOAD_TIMEOUT,
          }),
        );
        this.kill();
      }, PLUGIN_LOAD_TIMEOUT);

      this.child!.on("message", (msg: SandboxOut) => {
        this.onMessage(msg, done);
      });

      this.child!.on("exit", (code) => {
        const wasReady = this.ready;
        this.ready = false;
        this.stopHeartbeat();
        this.child = null;
        if (!settled) {
          done(
            Object.assign(new Error(`worker exited before ready, code=${code}`), {
              code: PluginErrorCodes.WORKER_CRASHED,
            }),
          );
        }
        if (wasReady && !this.disposed) {
          this.events.onExit(!this.intentionalKill, code);
        }
        this.intentionalKill = false;
      });

      // stdout/stderr 转发到 log 事件
      if (this.child!.stdout) {
        this.child!.stdout.on("data", (chunk: Buffer) => {
          this.events.onLog("info", [chunk.toString().trimEnd()]);
        });
      }
      if (this.child!.stderr) {
        this.child!.stderr.on("data", (chunk: Buffer) => {
          this.events.onLog("error", [chunk.toString().trimEnd()]);
        });
      }

      // 发送 init
      const initMsg: SandboxIn = {
        kind: "init",
        pluginId: this.opts.manifest.id,
        apiLevel: this.opts.manifest.apiLevel,
        locale: this.opts.locale,
        appVersion: app.getVersion(),
        platform: this.opts.manifest.platform,
        userSettings: this.opts.userSettings,
        source: this.opts.source,
        scriptInfo: {
          name: this.opts.manifest.name,
          description: this.opts.manifest.description ?? "",
          version: this.opts.manifest.version,
          author: this.opts.manifest.author ?? "",
          homepage: this.opts.manifest.homepage ?? "",
        },
      };
      this.child!.postMessage(initMsg);
    });
  }

  /** 把 action call 下发到沙箱 */
  sendCall(requestId: string, action: PluginAction, params: unknown): void {
    if (!this.child || !this.ready) {
      this.events.onResult(requestId, false, undefined, {
        code: PluginErrorCodes.NOT_READY,
        message: "plugin is not ready",
      });
      return;
    }
    const msg: SandboxIn = { kind: "call", requestId, action, params };
    this.child.postMessage(msg);
  }

  sendCancel(requestId: string): void {
    if (!this.child) return;
    this.child.postMessage({ kind: "cancel", requestId } satisfies SandboxIn);
  }

  sendHostResult(callId: string, ok: boolean, data?: unknown, error?: PluginErrorPayload): void {
    if (!this.child) return;
    this.child.postMessage({ kind: "hostResult", callId, ok, data, error } satisfies SandboxIn);
  }

  isAlive(): boolean {
    return this.child != null && this.ready && !this.disposed;
  }

  /** 主动 kill 子进程，会触发 onExit(isCrash=false) */
  kill(): void {
    if (!this.child) return;
    this.intentionalKill = true;
    try {
      this.child.kill();
    } catch {
      /* ignore */
    }
    this.stopHeartbeat();
  }

  /** 永久释放，之后不再重启 */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.kill();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatMisses = 0;
    this.heartbeatTimer = setInterval(() => {
      if (!this.child) return;
      this.heartbeatMisses++;
      if (this.heartbeatMisses > HEARTBEAT_MAX_MISSES) {
        this.events.onLog("warn", [`plugin ${this.opts.manifest.id} heartbeat lost, killing`]);
        this.kill();
        return;
      }
      this.child.postMessage({ kind: "ping" } satisfies SandboxIn);
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private onMessage(
    msg: SandboxOut,
    done: (err: Error | null, sources?: Record<string, SourceCapability>) => void,
  ): void {
    switch (msg.kind) {
      case "ready":
        this.events.onReady(msg.sources);
        done(null, msg.sources);
        return;
      case "result":
        this.events.onResult(msg.requestId, msg.ok, msg.data, msg.error);
        return;
      case "hostCall":
        this.events.onHostCall(msg.callId, msg.method, msg.args);
        return;
      case "updateAvailable":
        this.events.onUpdateAvailable(msg.info);
        return;
      case "log":
        this.events.onLog(msg.level, msg.args);
        return;
      case "pong":
        this.heartbeatMisses = 0;
        return;
      case "fatal":
        // fatal = 永久失败，不走 crash-restart。kill 是 worker 未自我退出时的兜底
        this.intentionalKill = true;
        this.events.onFatal(msg.error);
        done(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
        if (this.child) {
          try {
            this.child.kill();
          } catch {
            /* ignore */
          }
        }
        this.stopHeartbeat();
        return;
    }
  }
}
