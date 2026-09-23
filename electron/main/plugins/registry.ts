/**
 * 插件注册表
 *
 * - 扫描 `{userData}/app-data/plugins/scripts/` 下的 .js 文件
 * - 维护 `Map<id, PluginRuntime>`（manifest + 运行时状态）
 * - 提供 install / uninstall / setEnabled / 启停（插件跑在共享 host 进程的 vm 上下文里）
 * - 订阅 host 回调，处理 hostCall、fatal、host 整体崩溃重启
 */

import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { app } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import type {
  PlaybackEventKind,
  PluginAction,
  PluginInfo,
  PluginManifest,
  PluginMenuItem,
  PluginSettingItem,
  PluginStatus,
  PluginUpdateInfo,
} from "@shared/types/plugin";
import { PluginErrorCodes, RESTART_MAX_ATTEMPTS } from "@shared/defaults/plugin-api";
import { store } from "@main/store";
import { getLocale } from "@main/utils/i18n";
import { coreLog } from "@main/utils/logger";
import { pluginsDir } from "@main/utils/paths";
import { pluginHost, type PluginHostCallbacks, type PluginLoadSpec } from "./host-process";
import { loadScript } from "./loader";
import { dispatchHostCall } from "./host";
import { pluginStorageDrop } from "./storage";
import { fetchScript } from "./net";

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

/**
 * 判断 remote 版本是否比 current 新：按点分数字段逐段比较，缺省段补 0，非数字段当 0
 * @param remote - 远端版本号
 * @param current - 本地版本号
 */
const isNewerVersion = (remote: string, current: string): boolean => {
  const parse = (v: string): number[] =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .map((seg) => {
        const n = parseInt(seg, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const a = parse(remote);
  const b = parse(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
};

interface PluginRuntime {
  manifest: PluginManifest;
  enabled: boolean;
  status: PluginStatus;
  /** 是否有一次加载在途，防并发 start 重复下发 loadPlugin */
  loading: boolean;
  source: string;
  /** 有新版本提示：splayer 由宿主比对 @version 得出，lx 由脚本 updateAlert 自报；null 表示无 */
  updateInfo: PluginUpdateInfo | null;
  /** 控制类：订阅的播放事件列表，音源类为 [] */
  events: PlaybackEventKind[];
  /** 控制类：是否注册了反向控制能力 */
  controls: boolean;
  /** 控制类：声明的用户配置项 */
  settings: PluginSettingItem[];
  /** UI 类：已授予 ui 权限后接受的菜单项，否则为 [] */
  menus: PluginMenuItem[];
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
  /** host 进程整体崩溃的重启计数与定时器（爆炸半径=全部插件） */
  private hostRestartAttempts = 0;
  private hostRestartTimer: NodeJS.Timeout | null = null;

  /** 应用启动时调用 */
  init(): void {
    ensureDirs();
    pluginHost.setOnHostLost(() => this.handleHostLost());
    const stored = readStored();
    const enabledMap = store.get("plugins.enabled") as Record<string, boolean>;

    // 首先加载 stored manifest
    for (const [id, manifest] of Object.entries(stored.plugins)) {
      const scriptPath = path.join(scriptsDir(), manifest.fileName);
      let source = "";
      try {
        source = fs.readFileSync(scriptPath, "utf-8");
        // 重新解压（防止脚本外部被替换为 gz_）
        const fresh = loadScript(source, false, manifest.fileName);
        source = fresh.source;
        manifest.grant = fresh.manifest.grant;
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
        loading: false,
        updateInfo: null,
        events: [],
        controls: false,
        settings: [],
        menus: [],
        pending: new Map(),
      });
    }

    // 启动已启用的插件
    for (const rt of this.runtimes.values()) {
      if (rt.enabled) this.start(rt).catch(() => {});
    }
    // 启动时静默检查一遍更新（不阻塞启动）
    void this.checkAllUpdates();
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
      loading: false,
      updateInfo: null,
      events: [],
      controls: false,
      settings: [],
      menus: [],
      pending: new Map(),
    };
    this.runtimes.set(manifest.id, rt);
    await this.start(rt).catch(() => {});
    return { manifest, enabled: rt.enabled, status: rt.status, updateInfo: rt.updateInfo };
  }

  /** 取插件当前的更新地址（检查到新版后由 updateInfo 持有） */
  getUpdateUrl(id: string): string | undefined {
    return this.runtimes.get(id)?.updateInfo?.updateUrl ?? undefined;
  }

  /** 构造对外的插件信息 */
  private infoOf(rt: PluginRuntime): PluginInfo {
    return {
      manifest: rt.manifest,
      enabled: rt.enabled,
      status: rt.status,
      updateInfo: rt.updateInfo,
      settingsValues:
        (store.get(`plugins.perPlugin.${rt.manifest.id}` as never) as Record<string, unknown>) ??
        {},
    };
  }

  /**
   * 检查单个插件是否有新版：拉 @updateUrl 读远端 @version 与本地比对，有则置 updateInfo 并广播
   * @param id - 插件 ID
   * @returns ok 是否成功联网比对；hasUpdate 是否发现新版；plugin 最新信息
   */
  async checkUpdate(id: string): Promise<{ ok: boolean; hasUpdate: boolean; plugin?: PluginInfo }> {
    const rt = this.runtimes.get(id);
    if (!rt) return { ok: false, hasUpdate: false };
    const url = rt.manifest.updateUrl;
    if (!url) return { ok: false, hasUpdate: false, plugin: this.infoOf(rt) };

    const source = await fetchScript(url);
    const { manifest: remote } = loadScript(source, false);
    // 身份/类型必须一致才算同一插件的新版，防 updateUrl 指向了别的脚本
    const samePlugin =
      remote.id === id && (remote.type ?? "source") === (rt.manifest.type ?? "source");

    if (!samePlugin || !isNewerVersion(remote.version, rt.manifest.version)) {
      // 远端不比本地新：清掉可能残留的旧提示
      if (rt.updateInfo) {
        rt.updateInfo = null;
        this.setStatus(rt, rt.status);
      }
      return { ok: true, hasUpdate: false, plugin: this.infoOf(rt) };
    }

    rt.updateInfo = {
      version: remote.version,
      log: remote.changelog,
      updateUrl: url,
      updatedAt: Date.now(),
    };
    this.setStatus(rt, rt.status);
    return { ok: true, hasUpdate: true, plugin: this.infoOf(rt) };
  }

  /** 启动时静默检查所有声明了 @updateUrl 的插件 */
  async checkAllUpdates(): Promise<void> {
    const targets = [...this.runtimes.values()].filter((rt) => rt.manifest.updateUrl);
    await Promise.allSettled(targets.map((rt) => this.checkUpdate(rt.manifest.id)));
  }

  /**
   * 用新源码原地更新插件：保留 id / 启用态 / 用户设置 / 每插件存储
   * @param id - 现有插件 ID
   * @param rawSource - 新版脚本源码
   * @returns 更新后的插件信息
   */
  async applyUpdateFromSource(id: string, rawSource: string): Promise<PluginInfo> {
    const rt = this.runtimes.get(id);
    if (!rt) {
      throw Object.assign(new Error("plugin not found"), { code: PluginErrorCodes.NOT_FOUND });
    }
    const { source, manifest } = loadScript(rawSource, false);
    // 不变量守卫：名称（含平台）或类型变化 = 非同一插件，拒绝原地更新
    if (manifest.id !== id) {
      throw Object.assign(new Error("plugin name changed, please reinstall manually"), {
        code: PluginErrorCodes.INVALID_MANIFEST,
      });
    }
    if ((manifest.type ?? "source") !== (rt.manifest.type ?? "source")) {
      throw Object.assign(new Error("plugin type changed, please reinstall manually"), {
        code: PluginErrorCodes.INVALID_MANIFEST,
      });
    }

    // 固定文件名、保留安装时间、补更新时间
    manifest.fileName = `${id}.js`;
    manifest.installedAt = rt.manifest.installedAt;
    manifest.updatedAt = Date.now();

    fs.writeFileSync(path.join(scriptsDir(), manifest.fileName), source, "utf-8");
    const stored = readStored();
    stored.plugins[id] = manifest;
    writeStored(stored);

    // enabled / 用户设置 / 每插件存储均按 id 关联，id 不变即天然保留
    rt.updateInfo = null;
    await this.stop(rt);
    rt.manifest = manifest;
    rt.source = source;
    rt.events = [];
    rt.controls = false;
    rt.settings = [];
    rt.menus = [];

    if (rt.enabled) await this.start(rt).catch(() => {});
    else this.setStatus(rt, { state: "disabled" });

    return {
      manifest: rt.manifest,
      enabled: rt.enabled,
      status: rt.status,
      updateInfo: rt.updateInfo,
      settingsValues:
        (store.get(`plugins.perPlugin.${id}` as never) as Record<string, unknown>) ?? {},
    };
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
      this.hostRestartAttempts = 0; // 手动启用：恢复 host 重启额度
      // 启用路径的"无→有"翻转由 start() 内的 setStatus(ready) 负责发出，无需在此重复
      if (rt.status.state !== "ready") await this.start(rt).catch(() => {});
    } else {
      await this.stop(rt);
      this.setStatus(rt, { state: "disabled" });
      this.notifyControlActivity(before);
    }
  }

  /** 启动单个插件：在共享 host 进程里加载它 */
  private async start(rt: PluginRuntime): Promise<void> {
    const id = rt.manifest.id;
    if (pluginHost.isReady(id) || rt.loading) return; // 已就绪或正在加载
    rt.loading = true;
    this.setStatus(rt, { state: "loading" });

    const userSettings =
      (store.get(`plugins.perPlugin.${id}` as never) as Record<string, unknown> | undefined) ?? {};

    const spec: PluginLoadSpec = {
      pluginId: id,
      apiLevel: rt.manifest.apiLevel,
      locale: getLocale(),
      appVersion: app.getVersion(),
      userSettings,
      source: rt.source,
      scriptInfo: {
        name: rt.manifest.name,
        description: rt.manifest.description ?? "",
        version: rt.manifest.version,
        author: rt.manifest.author ?? "",
        homepage: rt.manifest.homepage ?? "",
      },
    };

    const callbacks: PluginHostCallbacks = {
      onReady: (sources) => {
        this.hostRestartAttempts = 0; // host 成功带起插件 → 重置 host 重启计数
        // 控制类同步 register 时 registered 先于 ready 到达，ready 必须保留已登记的
        // events/controls/settings/menus，否则会覆盖掉控制信息、导致设置表单不渲染
        this.setStatus(rt, {
          state: "ready",
          sources,
          events: rt.events,
          controls: rt.controls,
          settings: rt.settings,
          menus: rt.menus,
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
        void dispatchHostCall(id, rt.manifest.grant, callId, method, args);
      },
      onLog: (level, args) => {
        coreLog[level](`[plugin:${id}]`, ...args);
      },
      onUpdateAvailable: (info) => {
        rt.updateInfo = info;
        this.setStatus(rt, rt.status);
      },
      onSourcesUpdate: (sources) => {
        if (rt.status.state === "ready") {
          const merged = { ...rt.status.sources, ...sources };
          this.setStatus(rt, { ...rt.status, sources: merged });
        } else {
          this.setStatus(rt, {
            state: "ready",
            sources,
            events: rt.events,
            controls: rt.controls,
            settings: rt.settings,
            menus: rt.menus,
          });
        }
      },
      onRegistered: ({ events, controls, settings, menus: declaredMenus }) => {
        const menus = rt.manifest.grant.includes("ui") ? declaredMenus : [];
        if (declaredMenus.length && !menus.length) {
          coreLog.warn(`[plugin:${id}] 声明了菜单但缺少 "ui" 权限，已忽略`);
        }
        rt.events = events;
        rt.controls = controls;
        rt.settings = settings;
        rt.menus = menus;
        if (rt.status.state === "ready") {
          this.setStatus(rt, { ...rt.status, events, controls, settings, menus });
        } else {
          this.setStatus(rt, { state: "ready", sources: {}, events, controls, settings, menus });
        }
        this.maybePrimeControl(rt);
      },
      onFatal: (error) => {
        coreLog.error(`[plugin:${id}] fatal ${error.code}: ${error.message}`);
        this.setStatus(rt, { state: "error", error });
        this.rejectAllPending(rt, error.message, error.code);
      },
      onHostLost: () => {
        // host 整体丢失：失败在途调用，由 handleHostLost 统一安排整体重启
        this.rejectAllPending(rt, "plugin host lost", PluginErrorCodes.WORKER_CRASHED);
      },
    };

    try {
      await pluginHost.loadPlugin(spec, callbacks);
    } catch (err) {
      const code = ((err as any)?.code as string) ?? PluginErrorCodes.UNKNOWN;
      // host 丢失由 handleHostLost 统一重启；期间被 stop/禁用/已 ready 改写则不覆盖
      if (code !== PluginErrorCodes.WORKER_CRASHED && rt.enabled && rt.status.state === "loading") {
        const message = err instanceof Error ? err.message : String(err);
        coreLog.error(`[plugin:${id}] load failed ${code}: ${message}`);
        this.setStatus(rt, { state: "error", error: { code, message } });
      }
    } finally {
      rt.loading = false;
    }
  }

  /** host 进程整体丢失：按退避重载所有 enabled 插件（爆炸半径=全部，自愈） */
  private handleHostLost(): void {
    if (this.hostRestartTimer) return; // 已安排重启
    this.hostRestartAttempts++;
    const enabled = [...this.runtimes.values()].filter((rt) => rt.enabled);
    if (this.hostRestartAttempts > RESTART_MAX_ATTEMPTS) {
      for (const rt of enabled) {
        this.setStatus(rt, {
          state: "error",
          error: {
            code: PluginErrorCodes.WORKER_CRASHED,
            message: "plugin host crashed too many times",
          },
        });
      }
      return;
    }
    // 退避期间降级为 loading，避免 UI/解析仍把它们当 ready
    for (const rt of enabled) this.setStatus(rt, { state: "loading" });
    const delayMs = [2_000, 8_000, 30_000][this.hostRestartAttempts - 1] ?? 30_000;
    coreLog.warn(`[plugin] host 丢失，${delayMs}ms 后重载 ${enabled.length} 个插件`);
    this.hostRestartTimer = setTimeout(() => {
      this.hostRestartTimer = null;
      for (const rt of enabled) {
        if (rt.enabled) this.start(rt).catch(() => {});
      }
    }, delayMs);
  }

  private async stop(rt: PluginRuntime): Promise<void> {
    rt.loading = false;
    // 软卸载：dispose 该插件的 vm 上下文，host 进程与其它插件不受扰
    pluginHost.unloadPlugin(rt.manifest.id);
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
    if (
      rt.manifest.type === "control" &&
      rt.status.state === "ready" &&
      pluginHost.isReady(rt.manifest.id)
    ) {
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
        rt.events.includes(event)
      ) {
        pluginHost.sendEvent(rt.manifest.id, event, data);
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
      rt.events.includes(event)
    ) {
      pluginHost.sendEvent(id, event, data);
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
    if (pluginHost.isReady(id)) pluginHost.sendSettingsUpdate(id, { [key]: sanitized });
  }

  /** 应用退出前调用 */
  async shutdown(): Promise<void> {
    if (this.hostRestartTimer) {
      clearTimeout(this.hostRestartTimer);
      this.hostRestartTimer = null;
    }
    pluginHost.shutdown();
  }
}

export const pluginRegistry = new PluginRegistry();
export type { PluginRuntime };
