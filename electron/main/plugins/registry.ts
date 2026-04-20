/**
 * 插件注册表
 *
 * - 扫描 `{userData}/plugins/scripts/` 下的 .js 文件
 * - 维护 `Map<id, PluginRuntime>`（manifest + 运行时状态 + sandbox）
 * - 提供 install / uninstall / setEnabled / 启停
 * - 订阅 sandbox 事件，处理 hostCall、crash、重启
 */

import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { app } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import type { PluginInfo, PluginManifest, PluginStatus } from "@shared/types/plugin";
import { PluginErrorCodes, RESTART_MAX_ATTEMPTS } from "@shared/defaults/plugin-api";
import { store } from "@main/store";
import { getLocale } from "@main/utils/i18n";
import { coreLog } from "@main/utils/logger";
import { Sandbox } from "./sandbox";
import { loadScript } from "./loader";
import { dispatchHostCall } from "./host";
import { pluginStorageDrop } from "./storage";

const pluginsRoot = (): string => path.join(app.getPath("userData"), "plugins");
const scriptsDir = (): string => path.join(pluginsRoot(), "scripts");
const manifestFile = (): string => path.join(pluginsRoot(), "manifest.json");

interface StoredManifest {
  version: 1;
  plugins: Record<string, PluginManifest>;
}

const ensureDirs = (): void => {
  const dirs = [pluginsRoot(), scriptsDir(), path.join(pluginsRoot(), "data")];
  for (const d of dirs) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
};

const readStored = (): StoredManifest => {
  try {
    const raw = fs.readFileSync(manifestFile(), "utf-8");
    const data = JSON.parse(raw) as StoredManifest;
    if (data?.version === 1 && data.plugins) return data;
  } catch {
    /* ignore */
  }
  return { version: 1, plugins: {} };
};

const writeStored = (data: StoredManifest): void => {
  ensureDirs();
  atomicWriteSync(manifestFile(), JSON.stringify(data, null, 2));
};

interface PluginRuntime {
  manifest: PluginManifest;
  enabled: boolean;
  status: PluginStatus;
  sandbox: Sandbox | null;
  source: string;
  restartAttempts: number;
  /** router 注册的 pending 调用 */
  pending: Map<
    string,
    {
      resolve: (data: unknown) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >;
}

class PluginRegistry extends EventEmitter {
  private runtimes = new Map<string, PluginRuntime>();

  /** 应用启动时调用 */
  init(): void {
    ensureDirs();
    const stored = readStored();
    const enabledMap = store.get("plugins.enabled") as Record<string, boolean>;

    // 首先加载 stored manifest
    for (const [id, manifest] of Object.entries(stored.plugins)) {
      const scriptPath = path.join(scriptsDir(), manifest.fileName);
      let source = "";
      try {
        source = fs.readFileSync(scriptPath, "utf-8");
        // 重新解压（防止脚本外部被替换为 gz_）
        const { source: s } = loadScript(source, false, manifest.fileName);
        source = s;
      } catch (err) {
        coreLog.warn(`[plugin] failed to read ${manifest.fileName}:`, err);
        continue;
      }
      const enabled = enabledMap[id] ?? true;
      this.runtimes.set(id, {
        manifest,
        enabled,
        source,
        status: { state: "unloaded" },
        sandbox: null,
        restartAttempts: 0,
        pending: new Map(),
      });
    }

    // 启动已启用的插件
    for (const rt of this.runtimes.values()) {
      if (rt.enabled) this.start(rt).catch(() => {});
    }
    coreLog.info(`[plugin] registry initialized, ${this.runtimes.size} plugins loaded`);
  }

  listInfo(): PluginInfo[] {
    return Array.from(this.runtimes.values()).map((rt) => ({
      manifest: rt.manifest,
      enabled: rt.enabled,
      status: rt.status,
    }));
  }

  getRuntime(id: string): PluginRuntime | undefined {
    return this.runtimes.get(id);
  }

  /** 按动作选一个已就绪的插件（优先级 → 首个 ready） */
  pickForAction(action: keyof StoredPriority, source?: string): PluginRuntime | undefined {
    const priority = store.get(`plugins.priority.${action}` as never) as string[] | undefined;
    const ordered = (priority ?? []).slice();
    // 把不在 priority 里的但能承接此动作的也接上
    for (const rt of this.runtimes.values()) {
      if (!ordered.includes(rt.manifest.id)) ordered.push(rt.manifest.id);
    }
    for (const id of ordered) {
      const rt = this.runtimes.get(id);
      if (!rt || !rt.enabled || rt.status.state !== "ready") continue;
      // 检查是否声明了该源 + 动作
      const sources = (rt.status as Extract<PluginStatus, { state: "ready" }>).sources;
      const sourceKeys = source ? [source] : Object.keys(sources);
      for (const key of sourceKeys) {
        const cap = sources[key];
        if (cap && cap.actions.includes(action as never)) return rt;
      }
    }
    return undefined;
  }

  /** 导入本地脚本文件 */
  async install(filePath: string): Promise<PluginInfo> {
    ensureDirs();
    const raw = fs.readFileSync(filePath, "utf-8");
    const { source, manifest } = loadScript(raw, false);
    // 脚本落盘（明文）
    const fileName = `${manifest.id}.js`;
    fs.writeFileSync(path.join(scriptsDir(), fileName), source, "utf-8");
    manifest.fileName = fileName;

    // 记入 manifest.json
    const stored = readStored();
    stored.plugins[manifest.id] = manifest;
    writeStored(stored);

    // 默认启用
    const enabledMap = {
      ...(store.get("plugins.enabled") as Record<string, boolean>),
      [manifest.id]: true,
    };
    store.set("plugins.enabled", enabledMap);

    // 放入运行时
    const existing = this.runtimes.get(manifest.id);
    if (existing) await this.stop(existing);
    const rt: PluginRuntime = {
      manifest,
      enabled: true,
      source,
      status: { state: "unloaded" },
      sandbox: null,
      restartAttempts: 0,
      pending: new Map(),
    };
    this.runtimes.set(manifest.id, rt);
    await this.start(rt).catch(() => {});
    return { manifest, enabled: rt.enabled, status: rt.status };
  }

  async uninstall(id: string): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    await this.stop(rt);
    this.runtimes.delete(id);

    const stored = readStored();
    delete stored.plugins[id];
    writeStored(stored);

    try {
      fs.unlinkSync(path.join(scriptsDir(), rt.manifest.fileName));
    } catch {
      /* ignore */
    }
    pluginStorageDrop(id);

    const enabledMap = { ...(store.get("plugins.enabled") as Record<string, boolean>) };
    delete enabledMap[id];
    store.set("plugins.enabled", enabledMap);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    rt.enabled = enabled;
    const enabledMap = {
      ...(store.get("plugins.enabled") as Record<string, boolean>),
      [id]: enabled,
    };
    store.set("plugins.enabled", enabledMap);

    if (enabled) {
      if (rt.status.state !== "ready") await this.start(rt).catch(() => {});
    } else {
      await this.stop(rt);
      this.setStatus(rt, { state: "disabled" });
    }
  }

  /** 启动单个插件的 sandbox */
  private async start(rt: PluginRuntime): Promise<void> {
    if (rt.sandbox?.isAlive()) return;
    this.setStatus(rt, { state: "loading" });

    const userSettings =
      ((store.get(`plugins.perPlugin.${rt.manifest.id}` as never) as
        | Record<string, unknown>
        | undefined) ?? {});

    const sandbox = new Sandbox(
      {
        manifest: rt.manifest,
        source: rt.source,
        userSettings,
        locale: getLocale(),
      },
      {
        onReady: (sources) => {
          rt.restartAttempts = 0;
          this.setStatus(rt, { state: "ready", sources });
        },
        onResult: (requestId, ok, data, error) => {
          const p = rt.pending.get(requestId);
          if (!p) return;
          rt.pending.delete(requestId);
          clearTimeout(p.timer);
          if (ok) p.resolve(data);
          else {
            const err = new Error(error?.message ?? "call failed");
             
            (err as any).code = error?.code ?? PluginErrorCodes.UNKNOWN;
            p.reject(err);
          }
        },
        onHostCall: (callId, method, args) => {
          void dispatchHostCall(sandbox, rt.manifest.id, callId, method, args);
        },
        onLog: (level, args) => {
          coreLog[level](`[plugin:${rt.manifest.id}]`, ...args);
        },
        onFatal: (error) => {
          this.setStatus(rt, { state: "error", error });
          // 把所有 pending 失败掉
          for (const p of rt.pending.values()) {
            clearTimeout(p.timer);
            p.reject(Object.assign(new Error(error.message), { code: error.code }));
          }
          rt.pending.clear();
        },
        onExit: (isCrash) => {
          if (!isCrash) return;
          rt.restartAttempts++;
          if (rt.restartAttempts > RESTART_MAX_ATTEMPTS) {
            this.setStatus(rt, {
              state: "error",
              error: {
                code: PluginErrorCodes.WORKER_CRASHED,
                message: "plugin crashed too many times",
              },
            });
            return;
          }
          const delayMs = [2_000, 8_000, 30_000][rt.restartAttempts - 1] ?? 30_000;
          setTimeout(() => {
            if (rt.enabled) this.start(rt).catch(() => {});
          }, delayMs);
        },
      },
    );

    rt.sandbox = sandbox;
    try {
      await sandbox.start();
    } catch (err) {
       
      const code = ((err as any)?.code as string) ?? PluginErrorCodes.UNKNOWN;
      this.setStatus(rt, {
        state: "error",
        error: {
          code,
          message: err instanceof Error ? err.message : String(err),
        },
      });
      rt.sandbox = null;
    }
  }

  private async stop(rt: PluginRuntime): Promise<void> {
    if (rt.sandbox) {
      await rt.sandbox.dispose();
      rt.sandbox = null;
    }
    // 失败掉残留 pending
    for (const p of rt.pending.values()) {
      clearTimeout(p.timer);
      p.reject(
        Object.assign(new Error("plugin stopped"), {
          code: PluginErrorCodes.NOT_READY,
        }),
      );
    }
    rt.pending.clear();
    this.setStatus(rt, { state: "unloaded" });
  }

  private setStatus(rt: PluginRuntime, status: PluginStatus): void {
    rt.status = status;
    this.emit("status", {
      manifest: rt.manifest,
      enabled: rt.enabled,
      status,
    } satisfies PluginInfo);
  }

  /** 应用退出前调用 */
  async shutdown(): Promise<void> {
    await Promise.all(Array.from(this.runtimes.values()).map((rt) => this.stop(rt)));
  }
}

type StoredPriority = {
  search: string[];
  musicUrl: string[];
  lyric: string[];
  meta: string[];
};

export const pluginRegistry = new PluginRegistry();
export type { PluginRuntime };
