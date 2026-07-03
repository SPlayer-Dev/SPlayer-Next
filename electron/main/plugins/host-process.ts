/**
 * 插件 host 进程（主进程侧）
 *
 * 单例，拥有唯一的 utilityProcess（托管所有插件 vm 上下文）：
 * - ensureStarted 懒启动并带 epoch（generation），重启自增
 * - loadPlugin/unloadPlugin 控制单个插件，按 pluginId 收发
 * - 心跳监控整个 host；崩溃/卡死 → handleHostCrash → 回调各插件 onHostLost
 * - 陈旧消息守卫：死进程的迟到消息按 generation 丢弃
 */

import path from "node:path";
import { utilityProcess, type UtilityProcess, app } from "electron";
import type {
  HostCallMethod,
  PlaybackEventKind,
  PluginAction,
  PluginErrorPayload,
  PluginRegistration,
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
import { coreLog } from "@main/utils/logger";

/** 单个插件的回调集合（registry 注册） */
export interface PluginHostCallbacks {
  onReady: (sources: Record<string, SourceCapability>) => void;
  onResult: (requestId: string, ok: boolean, data?: unknown, error?: PluginErrorPayload) => void;
  onHostCall: (callId: string, method: HostCallMethod, args: unknown[]) => void;
  onLog: (level: "debug" | "info" | "warn" | "error", args: unknown[]) => void;
  onFatal: (error: PluginErrorPayload) => void;
  onUpdateAvailable: (info: PluginUpdateInfo) => void;
  onSourcesUpdate: (sources: Record<string, SourceCapability>) => void;
  onRegistered?: (reg: PluginRegistration) => void;
  /** host 进程整体丢失（崩溃/卡死），此插件随之失效，需上层安排整体重启 */
  onHostLost: () => void;
}

/** loadPlugin 入参（即 loadPlugin 消息去掉 kind） */
export type PluginLoadSpec = Omit<Extract<SandboxIn, { kind: "loadPlugin" }>, "kind">;

const resolveWorkerEntry = (): string =>
  path.join(app.getAppPath(), "out", "main", "host.worker.js");

class PluginHost {
  private child: UtilityProcess | null = null;
  /** 每次 (re)start 自增；用于丢弃死进程迟到消息 */
  private generation = 0;
  private hostReady = false;
  private startPromise: Promise<void> | null = null;
  private resolveStart: (() => void) | null = null;
  private rejectStart: ((err: Error) => void) | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatMisses = 0;

  private readonly callbacks = new Map<string, PluginHostCallbacks>();
  /** 已 ready 的插件 id（区别于"已登记 callbacks"） */
  private readonly readyPlugins = new Set<string>();
  private readonly pendingLoads = new Map<
    string,
    {
      resolve: (sources: Record<string, SourceCapability>) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  /** host 整体丢失时的上层回调（registry 注册，用于安排整体重启） */
  private onHostLostGlobal: (() => void) | null = null;
  setOnHostLost(cb: () => void): void {
    this.onHostLostGlobal = cb;
  }

  /** 懒启动 host 进程，resolve 于 hostReady */
  ensureStarted(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
      const generation = ++this.generation;
      const child = utilityProcess.fork(resolveWorkerEntry(), [], {
        serviceName: "splayer-plugin-host",
        stdio: "pipe",
      });
      this.child = child;
      this.hostReady = false;
      this.heartbeatMisses = 0;

      this.startTimer = setTimeout(() => {
        if (generation === this.generation && !this.hostReady) {
          coreLog.error("[plugin-host] host 启动超时");
          this.handleHostCrash("start-timeout");
        }
      }, PLUGIN_LOAD_TIMEOUT);

      child.on("message", (msg: SandboxOut) => {
        if (generation !== this.generation) return; // 陈旧进程
        this.onMessage(msg);
      });
      child.on("exit", (code) => {
        if (generation !== this.generation) return;
        coreLog.warn(`[plugin-host] host 进程退出 code=${code}`);
        this.handleHostCrash("exit");
      });
      child.stdout?.on("data", (chunk: Buffer) =>
        coreLog.info("[plugin-host]", chunk.toString().trimEnd()),
      );
      child.stderr?.on("data", (chunk: Buffer) =>
        coreLog.error("[plugin-host]", chunk.toString().trimEnd()),
      );
    });
    return this.startPromise;
  }

  /** 加载一个插件，resolve 于其 ready */
  async loadPlugin(
    spec: PluginLoadSpec,
    callbacks: PluginHostCallbacks,
  ): Promise<Record<string, SourceCapability>> {
    await this.ensureStarted();
    this.callbacks.set(spec.pluginId, callbacks);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingLoads.delete(spec.pluginId);
        this.post({ kind: "unloadPlugin", pluginId: spec.pluginId });
        reject(
          Object.assign(new Error("plugin load timeout"), { code: PluginErrorCodes.LOAD_TIMEOUT }),
        );
      }, PLUGIN_LOAD_TIMEOUT);
      this.pendingLoads.set(spec.pluginId, { resolve, reject, timer });
      this.post({ kind: "loadPlugin", ...spec });
    });
  }

  /** 卸载一个插件（软，host 进程不动） */
  unloadPlugin(pluginId: string): void {
    const pending = this.pendingLoads.get(pluginId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingLoads.delete(pluginId);
      // 在途加载必须 settle，否则 start() 里的 await 永久挂起
      pending.reject(
        Object.assign(new Error("plugin unloaded"), { code: PluginErrorCodes.NOT_READY }),
      );
    }
    this.callbacks.delete(pluginId);
    this.readyPlugins.delete(pluginId);
    this.post({ kind: "unloadPlugin", pluginId });
  }

  isReady(pluginId: string): boolean {
    return this.hostReady && this.readyPlugins.has(pluginId);
  }

  sendCall(pluginId: string, requestId: string, action: PluginAction, params: unknown): void {
    if (!this.isReady(pluginId)) {
      this.callbacks.get(pluginId)?.onResult(requestId, false, undefined, {
        code: PluginErrorCodes.NOT_READY,
        message: "plugin is not ready",
      });
      return;
    }
    this.post({ kind: "call", pluginId, requestId, action, params });
  }

  sendCancel(pluginId: string, requestId: string): void {
    this.post({ kind: "cancel", pluginId, requestId });
  }

  sendHostResult(
    pluginId: string,
    callId: string,
    ok: boolean,
    data?: unknown,
    error?: PluginErrorPayload,
  ): void {
    this.post({ kind: "hostResult", pluginId, callId, ok, data, error });
  }

  sendEvent(pluginId: string, event: PlaybackEventKind, data: unknown): void {
    if (!this.isReady(pluginId)) return;
    this.post({ kind: "event", pluginId, event, data });
  }

  sendSettingsUpdate(pluginId: string, settings: Record<string, unknown>): void {
    if (!this.isReady(pluginId)) return;
    this.post({ kind: "settingsUpdate", pluginId, settings });
  }

  /** 关闭 host（应用退出时） */
  shutdown(): void {
    this.generation++;
    this.stopHeartbeat();
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    const child = this.child;
    this.child = null;
    this.hostReady = false;
    this.startPromise = null;
    if (child) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  }

  private post(msg: SandboxIn): void {
    if (!this.child) return;
    try {
      this.child.postMessage(msg);
    } catch (err) {
      coreLog.error(`[plugin-host] postMessage failed kind=${msg.kind}: ${(err as Error).message}`);
    }
  }

  private onMessage(msg: SandboxOut): void {
    switch (msg.kind) {
      case "hostReady": {
        this.hostReady = true;
        if (this.startTimer) {
          clearTimeout(this.startTimer);
          this.startTimer = null;
        }
        this.startHeartbeat();
        this.resolveStart?.();
        return;
      }
      case "pong":
        this.heartbeatMisses = 0;
        return;
      case "ready": {
        const pending = this.pendingLoads.get(msg.pluginId);
        if (!pending) return; // 迟到/已取消的 ready：丢弃，避免污染 readyPlugins
        clearTimeout(pending.timer);
        this.pendingLoads.delete(msg.pluginId);
        this.readyPlugins.add(msg.pluginId);
        pending.resolve(msg.sources);
        this.callbacks.get(msg.pluginId)?.onReady(msg.sources);
        return;
      }
      case "result":
        this.callbacks.get(msg.pluginId)?.onResult(msg.requestId, msg.ok, msg.data, msg.error);
        return;
      case "hostCall":
        this.callbacks.get(msg.pluginId)?.onHostCall(msg.callId, msg.method, msg.args);
        return;
      case "updateAvailable":
        this.callbacks.get(msg.pluginId)?.onUpdateAvailable(msg.info);
        return;
      case "sourcesUpdate":
        this.callbacks.get(msg.pluginId)?.onSourcesUpdate(msg.sources);
        return;
      case "registered":
        this.callbacks.get(msg.pluginId)?.onRegistered?.(msg);
        return;
      case "log":
        if (msg.pluginId) this.callbacks.get(msg.pluginId)?.onLog(msg.level, msg.args);
        else coreLog[msg.level]("[plugin-host]", ...msg.args);
        return;
      case "fatal": {
        this.readyPlugins.delete(msg.pluginId);
        const pending = this.pendingLoads.get(msg.pluginId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingLoads.delete(msg.pluginId);
          pending.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
        }
        this.callbacks.get(msg.pluginId)?.onFatal(msg.error);
        return;
      }
    }
  }

  /** host 进程整体丢失：清理、通知各插件，由上层安排整体重启 */
  private handleHostCrash(reason: string): void {
    this.generation++; // 让旧进程后续消息全部失效
    this.stopHeartbeat();
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    const child = this.child;
    this.child = null;
    this.hostReady = false;
    this.startPromise = null;
    if (child) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
    // 启动期就崩：reject 启动 promise，让 await ensureStarted 的 loadPlugin 失败
    this.rejectStart?.(
      Object.assign(new Error(`plugin host lost: ${reason}`), {
        code: PluginErrorCodes.WORKER_CRASHED,
      }),
    );
    this.resolveStart = null;
    this.rejectStart = null;
    // 失败所有在途加载
    for (const pending of this.pendingLoads.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        Object.assign(new Error("plugin host lost"), { code: PluginErrorCodes.WORKER_CRASHED }),
      );
    }
    this.pendingLoads.clear();
    // 通知各插件失效
    const lost = [...this.callbacks.values()];
    this.callbacks.clear();
    this.readyPlugins.clear();
    for (const cb of lost) {
      try {
        cb.onHostLost();
      } catch {
        /* ignore */
      }
    }
    this.onHostLostGlobal?.();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatMisses = 0;
    this.heartbeatTimer = setInterval(() => {
      if (!this.child) return;
      this.heartbeatMisses++;
      if (this.heartbeatMisses > HEARTBEAT_MAX_MISSES) {
        coreLog.warn("[plugin-host] 心跳丢失，重启 host");
        this.handleHostCrash("heartbeat");
        return;
      }
      try {
        this.child.postMessage({ kind: "ping" } satisfies SandboxIn);
      } catch {
        /* ignore */
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export const pluginHost = new PluginHost();
