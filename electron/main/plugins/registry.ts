/**
 * 插件注册表
 *
 * - 扫描 `{userData}/app-data/plugins/scripts/` 下的 .js 文件
 * - 维护 `Map<id, PluginRuntime>`（manifest + 运行时状态 + sandbox）
 * - 提供 install / uninstall / setEnabled / 启停
 * - 订阅 sandbox 事件，处理 hostCall、crash、重启
 */

import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { writeFileSync as atomicWriteSync } from "atomically";
import type {
  PlaybackEventKind,
  PluginAction,
  PluginInfo,
  PluginManifest,
  PluginSettingItem,
  PluginStatus,
  PluginUpdateInfo,
} from "@shared/types/plugin";
import { PluginErrorCodes, RESTART_MAX_ATTEMPTS } from "@shared/defaults/plugin-api";
import { store } from "@main/store";
import { getLocale } from "@main/utils/i18n";
import { coreLog } from "@main/utils/logger";
import { pluginsDir } from "@main/utils/paths";
import { Sandbox } from "./sandbox";
import { loadScript } from "./loader";
import { dispatchHostCall } from "./host";
import { pluginStorageDrop } from "./storage";

const pluginsRoot = (): string => pluginsDir;
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
  /** 脚本上报的"有新版本"信息，null/undefined 表示没提示过 */
  updateInfo: PluginUpdateInfo | null;
  /** 控制类：订阅的播放事件列表，音源类为 [] */
  events: PlaybackEventKind[];
  /** 控制类：是否注册了反向控制能力 */
  controls: boolean;
  /** 控制类：声明的用户配置项 */
  settings: PluginSettingItem[];
  /** router 注册的 pending 调用 */
  pending: Map<
    string,
    {
      resolve: (data: unknown) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >;
  /** 崩溃后的重启定时器句柄；stop 时必须清除，否则卸载/替换后插件会被复活成孤儿 worker */
  restartTimer: NodeJS.Timeout | null;
}

/** 按 schema 校验/强转设置值 */
const sanitizeSettingValue = (item: PluginSettingItem, value: unknown): unknown => {
  switch (item.type) {
    case "switch":
      return Boolean(value);
    case "number": {
      let num = Number(value);
      if (!Number.isFinite(num)) num = Number(item.default);
      if (item.min != null) num = Math.max(item.min, num);
      if (item.max != null) num = Math.min(item.max, num);
      return num;
    }
    case "select": {
      const ok = item.options?.some((opt) => opt.value === value);
      return ok ? value : item.default;
    }
    case "text":
    default:
      return String(value ?? "");
  }
};

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
        updateInfo: null,
        events: [],
        controls: false,
        settings: [],
        pending: new Map(),
        restartTimer: null,
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
      updateInfo: rt.updateInfo,
      settingsValues:
        (store.get(`plugins.perPlugin.${rt.manifest.id}` as never) as Record<string, unknown>) ??
        {},
    }));
  }

  getRuntime(id: string): PluginRuntime | undefined {
    return this.runtimes.get(id);
  }

  /** 按动作选一个已就绪的插件（优先级 → 首个 ready） */
  pickForAction(action: PluginAction, source?: string): PluginRuntime | undefined {
    const priority = store.get(`plugins.priority.${action}` as never) as string[] | undefined;
    const ordered = (priority ?? []).slice();
    for (const rt of this.runtimes.values()) {
      if (!ordered.includes(rt.manifest.id)) ordered.push(rt.manifest.id);
    }
    for (const id of ordered) {
      const rt = this.runtimes.get(id);
      if (!rt || !rt.enabled || rt.status.state !== "ready") continue;
      const sources = rt.status.sources;
      const sourceKeys = source ? [source] : Object.keys(sources);
      for (const key of sourceKeys) {
        const cap = sources[key];
        if (cap && cap.actions.includes(action)) return rt;
      }
    }
    return undefined;
  }

  /** 导入本地脚本文件 */
  async install(filePath: string): Promise<PluginInfo> {
    const raw = fs.readFileSync(filePath, "utf-8");
    return this.installFromSource(raw);
  }

  /** 从脚本源码安装（供本地文件、URL 下载等入口复用） */
  async installFromSource(raw: string): Promise<PluginInfo> {
    ensureDirs();
    const { source, manifest } = loadScript(raw, false);
    // 脚本落盘（明文）
    const fileName = `${manifest.id}.js`;
    fs.writeFileSync(path.join(scriptsDir(), fileName), source, "utf-8");
    manifest.fileName = fileName;

    // 记入 manifest.json
    const stored = readStored();
    stored.plugins[manifest.id] = manifest;
    writeStored(stored);

    // 互斥：仅 source 类插件之间互斥——新装 source 时，先停掉其他已启用的 source 插件
    if ((manifest.type ?? "source") === "source") {
      const others = [...this.runtimes.values()].filter(
        (other) =>
          other.manifest.id !== manifest.id &&
          other.enabled &&
          (other.manifest.type ?? "source") === "source",
      );
      for (const other of others) {
        await this.setEnabled(other.manifest.id, false);
      }
    }

    // 默认启用新插件
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
      updateInfo: null,
      events: [],
      controls: false,
      settings: [],
      pending: new Map(),
      restartTimer: null,
    };
    this.runtimes.set(manifest.id, rt);
    await this.start(rt).catch(() => {});
    return { manifest, enabled: rt.enabled, status: rt.status, updateInfo: rt.updateInfo };
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
    // 在翻转 enabled 标志前取样：禁用路径里 setStatus 观测不到这次"启用→禁用"的翻转
    // （disabled/unloaded 状态本就非 ready，谓词两侧均为 false），需在此处补发
    const before = this.hasEnabledControlPlugin();
    rt.enabled = enabled;
    const enabledMap = {
      ...(store.get("plugins.enabled") as Record<string, boolean>),
      [id]: enabled,
    };
    store.set("plugins.enabled", enabledMap);

    if (enabled) {
      // 手动启用：重置崩溃计数，恢复重启额度（曾达上限的插件不会一崩就直接 error）
      rt.restartAttempts = 0;
      // 启用路径的"无→有"翻转由 start() 内的 setStatus(ready) 负责发出，无需在此重复
      if (rt.status.state !== "ready") await this.start(rt).catch(() => {});
    } else {
      await this.stop(rt);
      this.setStatus(rt, { state: "disabled" });
      this.notifyControlActivity(before);
    }
  }

  /** 启动单个插件的 sandbox */
  private async start(rt: PluginRuntime): Promise<void> {
    if (rt.sandbox?.isAlive()) return;
    // 既然现在就要启动，取消可能挂着的崩溃重启定时器
    if (rt.restartTimer) {
      clearTimeout(rt.restartTimer);
      rt.restartTimer = null;
    }
    this.setStatus(rt, { state: "loading" });

    const userSettings =
      (store.get(`plugins.perPlugin.${rt.manifest.id}` as never) as
        | Record<string, unknown>
        | undefined) ?? {};

    const sandbox = new Sandbox(
      {
        manifest: rt.manifest,
        source: rt.source,
        userSettings,
        locale: getLocale(),
      },
      {
        onReady: (sources) => {
          if (rt.sandbox !== sandbox) return; // 过期实例的回调（期间已被 stop/替换），丢弃
          rt.restartAttempts = 0;
          // 控制类同步 register 时 registered 先于 ready 到达，ready 必须保留已登记的
          // events/controls/settings，否则会覆盖掉控制信息、导致设置表单不渲染
          this.setStatus(rt, {
            state: "ready",
            sources,
            events: rt.events,
            controls: rt.controls,
            settings: rt.settings,
          });
          this.maybePrimeControl(rt);
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
        onUpdateAvailable: (info) => {
          rt.updateInfo = info;
          // 沿当前状态再广播一次，渲染端就能拿到 updateInfo 字段
          this.setStatus(rt, rt.status);
        },
        onSourcesUpdate: (sources) => {
          // 异步 lx.send('inited') / splayer.register 触发
          if (rt.status.state !== "ready") return;
          const merged = { ...rt.status.sources, ...sources };
          // 保留已登记的 events/controls/settings，避免增量补报 sources 时被清掉
          this.setStatus(rt, { ...rt.status, sources: merged });
        },
        onRegistered: (events, controls, settings) => {
          rt.events = events;
          rt.controls = controls;
          rt.settings = settings;
          // ready 状态由此建立；"无→有"的 controlActivityChange 由 setStatus 内集中发出
          if (rt.status.state === "ready") {
            this.setStatus(rt, { ...rt.status, events, controls, settings });
          } else {
            this.setStatus(rt, { state: "ready", sources: {}, events, controls, settings });
          }
          this.maybePrimeControl(rt);
        },
        onFatal: (error) => {
          if (rt.sandbox !== sandbox) return; // 过期实例，忽略
          // 同时记录到主日志，避免错误只在 UI 卡片里可见
          coreLog.error(`[plugin:${rt.manifest.id}] fatal ${error.code}: ${error.message}`);
          this.setStatus(rt, { state: "error", error });
          this.rejectAllPending(rt, error.message, error.code);
        },
        onExit: (isCrash) => {
          if (rt.sandbox !== sandbox) return; // 过期实例退出，忽略
          if (!isCrash) return;
          // 崩溃使在途调用永无结果，立即失败掉而非挂到各自超时
          this.rejectAllPending(rt, "plugin crashed", PluginErrorCodes.WORKER_CRASHED);
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
          rt.restartTimer = setTimeout(() => {
            rt.restartTimer = null;
            if (rt.enabled) this.start(rt).catch(() => {});
          }, delayMs);
        },
      },
    );

    rt.sandbox = sandbox;
    try {
      await sandbox.start();
    } catch (err) {
      if (rt.sandbox !== sandbox) return; // 期间已被 stop/替换，别用陈旧结果覆盖新状态
      const code = ((err as any)?.code as string) ?? PluginErrorCodes.UNKNOWN;
      const message = err instanceof Error ? err.message : String(err);
      coreLog.error(`[plugin:${rt.manifest.id}] start failed ${code}: ${message}`);
      this.setStatus(rt, {
        state: "error",
        error: { code, message },
      });
      rt.sandbox = null;
    }
  }

  private async stop(rt: PluginRuntime): Promise<void> {
    // 取消可能挂着的崩溃重启定时器，否则卸载/替换后插件会被复活
    if (rt.restartTimer) {
      clearTimeout(rt.restartTimer);
      rt.restartTimer = null;
    }
    if (rt.sandbox) {
      await rt.sandbox.dispose();
      rt.sandbox = null;
    }
    this.rejectAllPending(rt, "plugin stopped", PluginErrorCodes.NOT_READY);
    this.setStatus(rt, { state: "unloaded" });
  }

  /** 失败并清空某插件的全部在途调用 */
  private rejectAllPending(rt: PluginRuntime, message: string, code: string): void {
    for (const pendingCall of rt.pending.values()) {
      clearTimeout(pendingCall.timer);
      pendingCall.reject(Object.assign(new Error(message), { code }));
    }
    rt.pending.clear();
  }

  private setStatus(rt: PluginRuntime, status: PluginStatus): void {
    const before = this.hasEnabledControlPlugin();
    rt.status = status;
    this.emit("status", {
      manifest: rt.manifest,
      enabled: rt.enabled,
      status,
      updateInfo: rt.updateInfo,
      settingsValues:
        (store.get(`plugins.perPlugin.${rt.manifest.id}` as never) as Record<string, unknown>) ??
        {},
    } satisfies PluginInfo);
    this.notifyControlActivity(before);
  }

  /**
   * 控制类插件就绪后请求 bridge 定向补发快照
   * @param rt - 插件运行时
   */
  private maybePrimeControl(rt: PluginRuntime): void {
    if (rt.manifest.type === "control" && rt.status.state === "ready" && rt.sandbox?.isAlive()) {
      this.emit("controlPluginReady", rt.manifest.id);
    }
  }

  /** 控制类插件的"有/无"状态翻转时通知（驱动 bridge 惰性挂载/卸载） */
  private notifyControlActivity(before: boolean): void {
    const after = this.hasEnabledControlPlugin();
    if (before !== after) this.emit("controlActivityChange", after);
  }

  /** 是否存在已启用且 ready 的控制类插件 */
  hasEnabledControlPlugin(): boolean {
    for (const rt of this.runtimes.values()) {
      if (rt.enabled && rt.manifest.type === "control" && rt.status.state === "ready") return true;
    }
    return false;
  }

  /**
   * 扇出高层播放事件给订阅了该事件的控制类插件
   * @param event - 播放事件类型
   * @param data - 事件载荷
   */
  broadcastPlaybackEvent(event: PlaybackEventKind, data: unknown): void {
    for (const rt of this.runtimes.values()) {
      if (
        rt.enabled &&
        rt.manifest.type === "control" &&
        rt.status.state === "ready" &&
        rt.events.includes(event) &&
        rt.sandbox?.isAlive()
      ) {
        rt.sandbox.sendEvent(event, data);
      }
    }
  }

  /**
   * 向单个控制类插件定向下发播放事件（用于新就绪插件的快照补发）
   * @param id - 插件 ID
   * @param event - 播放事件类型
   * @param data - 事件载荷
   */
  sendPlaybackEventTo(id: string, event: PlaybackEventKind, data: unknown): void {
    const rt = this.runtimes.get(id);
    if (
      rt &&
      rt.enabled &&
      rt.manifest.type === "control" &&
      rt.status.state === "ready" &&
      rt.events.includes(event) &&
      rt.sandbox?.isAlive()
    ) {
      rt.sandbox.sendEvent(event, data);
    }
  }

  /**
   * 写入某插件单个设置并实时下发沙箱
   * @param id - 插件 ID
   * @param key - 设置键名
   * @param value - 待写入值（经 schema 校验后存储）
   */
  async setSetting(id: string, key: string, value: unknown): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    const item = rt.settings.find((setting) => setting.key === key);
    // 未在 schema 声明的 key 一律忽略，插件只能读写自己声明过的设置
    if (!item) return;
    const sanitized = sanitizeSettingValue(item, value);
    const all = {
      ...((store.get(`plugins.perPlugin.${id}` as never) as Record<string, unknown>) ?? {}),
      [key]: sanitized,
    };
    store.set(`plugins.perPlugin.${id}` as never, all);
    if (rt.sandbox?.isAlive()) rt.sandbox.sendSettingsUpdate({ [key]: sanitized });
  }

  /** 应用退出前调用 */
  async shutdown(): Promise<void> {
    await Promise.all(Array.from(this.runtimes.values()).map((rt) => this.stop(rt)));
  }
}

export const pluginRegistry = new PluginRegistry();
export type { PluginRuntime };
