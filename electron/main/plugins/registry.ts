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
  PluginGrant,
  PluginPermissions,
} from "@shared/types/plugin";
import {
  HOST_API_LEVEL,
  PluginErrorCodes,
  RESTART_MAX_ATTEMPTS,
} from "@shared/defaults/plugin-api";
import { store } from "@main/store";
import { getLocale } from "@main/utils/i18n";
import { coreLog } from "@main/utils/logger";
import { pluginsDir } from "@main/utils/paths";
import { pluginHost, type PluginHostCallbacks, type PluginLoadSpec } from "./host-process";
import { loadScript } from "./loader";
import { dispatchHostCall } from "./host";
import { pluginStorageDrop, pluginStorageRelease, shutdownPluginStorage } from "./storage";
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

export interface PluginRuntime {
  hostSession?: AbortController;
  /** 首次启动任务，恢复独立来源曲目时只等待所属插件 */
  initialLoad?: Promise<void>;
  manifest: PluginManifest;
  enabled: boolean;
  status: PluginStatus;
  /** 是否有一次加载在途，防并发 start 重复下发 loadPlugin */
  loading: boolean;
  source: string;
  /** 有新版本提示：splayer 由宿主比对 @version 得出，lx 由脚本 updateAlert 自报；null 表示无 */
  updateInfo: PluginUpdateInfo | null;
  /** 订阅的播放事件列表 */
  events: PlaybackEventKind[];
  /** 插件能力：是否注册了反向控制能力 */
  controls: boolean;
  /** 插件能力：声明的用户配置项 */
  settings: PluginSettingItem[];
  /** 插件声明的菜单项，展示和执行时检查 ui 权限 */
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
    pluginHost.setOnHostStable(() => {
      this.hostRestartAttempts = 0;
    });
    const stored = readStored();
    const enabledMap = store.get("plugins.enabled") as Record<string, boolean>;

    // 首先加载 stored manifest
    for (const [id, storedManifest] of Object.entries(stored.plugins)) {
      let manifest = storedManifest;
      const scriptPath = path.join(scriptsDir(), manifest.fileName);
      let source = "";
      try {
        source = fs.readFileSync(scriptPath, "utf-8");
        // 重新解压（防止脚本外部被替换为 gz_）
        const fresh = loadScript(source, false, manifest.fileName);
        source = fresh.source;
        manifest = {
          ...fresh.manifest,
          id,
          installedAt: storedManifest.installedAt,
          updatedAt: storedManifest.updatedAt,
        };
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

    const savedSettings = store.get("plugins.perPlugin");
    const settingsById = { ...savedSettings };
    let settingsChanged = false;
    // 旧设置按 dot path 保存；先读取所有插件，避免相近 ID 在转换时互相覆盖。
    for (const id of this.runtimes.keys()) {
      if (!id.includes(".") || Object.hasOwn(savedSettings, id)) continue;
      const values = store.get(`plugins.perPlugin.${id}` as never);
      if (values && typeof values === "object" && !Array.isArray(values)) {
        settingsById[id] = values as Record<string, unknown>;
        settingsChanged = true;
      }
    }
    if (settingsChanged) store.set("plugins.perPlugin", settingsById);

    // 启动已启用的插件
    for (const rt of this.runtimes.values()) {
      if (rt.enabled) rt.initialLoad = this.start(rt).catch(() => {});
    }
    coreLog.info(`[plugin] registry initialized, ${this.runtimes.size} plugins loaded`);
  }

  /**
   * 读取全部插件的状态、设置与实时授权
   * @returns 供界面使用的插件列表
   */
  listInfo(): PluginInfo[] {
    return Array.from(this.runtimes.values()).map((rt) => ({
      manifest: rt.manifest,
      permissions: this.permissionsOf(rt.manifest),
      enabled: rt.enabled,
      status: rt.status,
      updateInfo: rt.updateInfo,
      settingsValues: this.settingsOf(rt.manifest.id),
    }));
  }

  getRuntime(id: string): PluginRuntime | undefined {
    return this.runtimes.get(id);
  }

  /**
   * 按完整插件标识读取设置，避免将点号解释为配置路径
   * @param id - 插件标识
   * @returns 插件已保存的设置
   */
  private settingsOf(id: string): Record<string, unknown> {
    const all = store.get("plugins.perPlugin");
    return Object.hasOwn(all, id) ? all[id] : {};
  }

  /**
   * 合并插件声明与用户授权，未关闭的权限默认允许
   * @param manifest - 插件清单
   * @returns 插件各项权限的实时状态
   */
  private permissionsOf(manifest: PluginManifest): PluginPermissions {
    const saved = store.get("plugins.permissions")?.[manifest.id];
    return Object.fromEntries(manifest.grant.map((grant) => [grant, saved?.[grant] ?? true]));
  }

  /**
   * 读取当前允许的权限，供宿主调用与菜单统一检查
   * @param id - 插件标识
   * @returns 用户允许且插件已声明的权限
   */
  getGrantedPermissions(id: string): PluginGrant[] {
    const rt = this.runtimes.get(id);
    if (!rt) return [];
    const permissions = this.permissionsOf(rt.manifest);
    return rt.manifest.grant.filter((grant) => permissions[grant]);
  }

  /**
   * 保存用户权限选择并广播，后续调用读取实时授权
   * @param id - 插件 ID
   * @param grant - 已声明的权限
   * @param enabled - 是否允许
   */
  async setPermission(id: string, grant: PluginGrant, enabled: boolean): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt || !rt.manifest.grant.includes(grant) || typeof enabled !== "boolean") {
      throw new Error("Invalid plugin permission");
    }
    if (this.permissionsOf(rt.manifest)[grant] === enabled) return;
    const all = store.get("plugins.permissions");
    store.set("plugins.permissions", {
      ...all,
      [id]: { ...all?.[id], [grant]: enabled },
    });
    this.setStatus(rt, rt.status);
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

  /**
   * 从源码安装插件并启动沙箱
   * @param raw - 待安装的脚本源码
   * @returns 安装后的插件状态
   */
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
    return this.infoOf(rt);
  }

  /** 取插件当前的更新地址（检查到新版后由 updateInfo 持有） */
  getUpdateUrl(id: string): string | undefined {
    return this.runtimes.get(id)?.updateInfo?.updateUrl ?? undefined;
  }

  /**
   * 构造包含实时授权与设置的插件信息
   * @param rt - 插件运行时
   * @returns 对外的插件状态
   */
  private infoOf(rt: PluginRuntime): PluginInfo {
    return {
      permissions: this.permissionsOf(rt.manifest),
      manifest: rt.manifest,
      enabled: rt.enabled,
      status: rt.status,
      updateInfo: rt.updateInfo,
      settingsValues: this.settingsOf(rt.manifest.id),
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
    // 按身份识别更新，防止 updateUrl 指向其他插件
    const samePlugin = remote.id === id;

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
    // 身份变化时拒绝原地更新
    if (manifest.id !== id) {
      throw Object.assign(new Error("plugin name changed, please reinstall manually"), {
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
      permissions: this.permissionsOf(rt.manifest),
      enabled: rt.enabled,
      status: rt.status,
      updateInfo: rt.updateInfo,
      settingsValues: this.settingsOf(id),
    };
  }

  /**
   * 停止插件并删除脚本、存储与授权记录
   * @param id - 插件标识
   */
  async uninstall(id: string): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    await this.stop(rt);
    await pluginStorageDrop(id);
    this.runtimes.delete(id);

    const stored = readStored();
    delete stored.plugins[id];
    writeStored(stored);

    try {
      fs.unlinkSync(path.join(scriptsDir(), rt.manifest.fileName));
    } catch {
      /* ignore */
    }
    const permissions = { ...store.get("plugins.permissions") };
    delete permissions[id];
    store.set("plugins.permissions", permissions);

    const enabledMap = { ...(store.get("plugins.enabled") as Record<string, boolean>) };
    delete enabledMap[id];
    store.set("plugins.enabled", enabledMap);
  }

  /**
   * 切换插件启用状态并启动或停止沙箱
   * @param id - 插件标识
   * @param enabled - 是否启用插件
   */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    // 在翻转 enabled 标志前取样：禁用路径里 setStatus 观测不到这次"启用→禁用"的翻转
    // （disabled/unloaded 状态本就非 ready，谓词两侧均为 false），需在此处补发
    const before = this.hasPlaybackSubscribers();
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
      this.notifyPlaybackActivity(before);
    }
  }

  /**
   * 在共享宿主中启动插件并隔离本次加载会话
   * @param rt - 待启动的插件运行时
   */
  private async start(rt: PluginRuntime): Promise<void> {
    const id = rt.manifest.id;
    if (pluginHost.isReady(id) || rt.loading) return; // 已就绪或正在加载
    rt.loading = true;
    rt.hostSession?.abort();
    const hostSession = new AbortController();
    rt.hostSession = hostSession;
    this.setStatus(rt, { state: "loading" });

    const userSettings = this.settingsOf(id);

    const spec: PluginLoadSpec = {
      pluginId: id,
      apiLevel: HOST_API_LEVEL,
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
        // 同步 register 时 registered 先于 ready 到达，ready 必须保留已登记的
        // events/controls/settings/menus，否则会覆盖掉注册信息、导致设置表单不渲染
        this.setStatus(rt, {
          state: "ready",
          sources,
          events: rt.events,
          controls: rt.controls,
          settings: rt.settings,
          menus: rt.menus,
        });
        this.primePlaybackSubscriber(rt);
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
        void dispatchHostCall(
          id,
          () => this.getGrantedPermissions(id),
          callId,
          method,
          args,
          () => !hostSession.signal.aborted,
          rt.manifest.name,
        );
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
      onRegistered: ({ events, controls, settings, menus }) => {
        const before = this.hasPlaybackSubscribers();
        rt.events = events;
        rt.controls = controls;
        rt.settings = settings;
        rt.menus = menus;
        if (rt.status.state === "ready") {
          this.setStatus(rt, { ...rt.status, events, controls, settings, menus }, before);
        } else {
          this.setStatus(
            rt,
            { state: "ready", sources: {}, events, controls, settings, menus },
            before,
          );
        }
        this.primePlaybackSubscriber(rt);
      },
      onFatal: (error) => {
        hostSession.abort();
        coreLog.error(`[plugin:${id}] fatal ${error.code}: ${error.message}`);
        this.setStatus(rt, { state: "error", error });
        this.rejectAllPending(rt, error.message, error.code);
      },
      onHostLost: () => {
        hostSession.abort();
        // host 整体丢失：失败在途调用，由 handleHostLost 统一安排整体重启
        this.rejectAllPending(rt, "plugin host lost", PluginErrorCodes.WORKER_CRASHED);
      },
    };

    try {
      await pluginHost.loadPlugin(spec, callbacks);
    } catch (err) {
      if (rt.hostSession !== hostSession) return;
      const code = ((err as any)?.code as string) ?? PluginErrorCodes.UNKNOWN;
      // host 丢失由 handleHostLost 统一重启；期间被 stop/禁用/已 ready 改写则不覆盖
      if (code !== PluginErrorCodes.WORKER_CRASHED && rt.enabled && rt.status.state === "loading") {
        const message = err instanceof Error ? err.message : String(err);
        coreLog.error(`[plugin:${id}] load failed ${code}: ${message}`);
        this.setStatus(rt, { state: "error", error: { code, message } });
      }
    } finally {
      if (rt.hostSession === hostSession) rt.loading = false;
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

  /**
   * 取消插件加载与在途调用并卸载沙箱
   * @param rt - 待停止的插件运行时
   */
  private async stop(rt: PluginRuntime): Promise<void> {
    rt.hostSession?.abort();
    rt.loading = false;
    // 软卸载：dispose 该插件的 vm 上下文，host 进程与其它插件不受扰
    pluginHost.unloadPlugin(rt.manifest.id);
    this.rejectAllPending(rt, "plugin stopped", PluginErrorCodes.NOT_READY);
    this.setStatus(rt, { state: "unloaded" });
    await pluginStorageRelease(rt.manifest.id);
  }

  /** 失败并清空某插件的全部在途调用 */
  private rejectAllPending(rt: PluginRuntime, message: string, code: string): void {
    for (const pendingCall of rt.pending.values()) {
      clearTimeout(pendingCall.timer);
      pendingCall.reject(Object.assign(new Error(message), { code }));
    }
    rt.pending.clear();
  }

  /**
   * 更新插件状态并通知界面与播放事件桥
   * @param rt - 插件运行时
   * @param status - 新的插件状态
   * @param hadSubscribers - 更新前是否存在播放事件订阅者
   */
  private setStatus(
    rt: PluginRuntime,
    status: PluginStatus,
    hadSubscribers = this.hasPlaybackSubscribers(),
  ): void {
    rt.status = status;
    this.emit("status", {
      permissions: this.permissionsOf(rt.manifest),
      manifest: rt.manifest,
      enabled: rt.enabled,
      status,
      updateInfo: rt.updateInfo,
      settingsValues: this.settingsOf(rt.manifest.id),
    } satisfies PluginInfo);
    this.notifyPlaybackActivity(hadSubscribers);
  }

  /**
   * 有播放事件订阅的插件就绪后，定向补发快照
   * @param rt - 插件运行时
   */
  private primePlaybackSubscriber(rt: PluginRuntime): void {
    if (rt.events.length > 0 && rt.status.state === "ready" && pluginHost.isReady(rt.manifest.id)) {
      this.emit("playbackSubscriberReady", rt.manifest.id);
    }
  }

  /**
   * 在订阅者有无变化时通知播放事件桥
   * @param before - 更新前是否存在播放事件订阅者
   */
  private notifyPlaybackActivity(before: boolean): void {
    const after = this.hasPlaybackSubscribers();
    if (before !== after) this.emit("playbackActivityChange", after);
  }

  /**
   * 检查是否有已启用且就绪的播放事件订阅者
   * @returns 是否需要保持播放事件桥接
   */
  hasPlaybackSubscribers(): boolean {
    for (const rt of this.runtimes.values()) {
      if (rt.enabled && rt.events.length > 0 && rt.status.state === "ready") return true;
    }
    return false;
  }

  /**
   * 扇出高层播放事件给订阅了该事件的插件
   * @param event - 播放事件类型
   * @param data - 事件载荷
   */
  broadcastPlaybackEvent(event: PlaybackEventKind, data: unknown): void {
    for (const rt of this.runtimes.values()) {
      if (
        rt.enabled &&
        rt.events.length > 0 &&
        rt.status.state === "ready" &&
        rt.events.includes(event)
      ) {
        pluginHost.sendEvent(rt.manifest.id, event, data);
      }
    }
  }

  /**
   * 向单个插件定向下发播放事件（用于新就绪插件的快照补发）
   * @param id - 插件 ID
   * @param event - 播放事件类型
   * @param data - 事件载荷
   */
  sendPlaybackEventTo(id: string, event: PlaybackEventKind, data: unknown): void {
    const rt = this.runtimes.get(id);
    if (
      rt &&
      rt.enabled &&
      rt.events.length > 0 &&
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
      ...this.settingsOf(id),
      [key]: sanitized,
    };
    store.set("plugins.perPlugin", { ...store.get("plugins.perPlugin"), [id]: all });
    if (pluginHost.isReady(id)) pluginHost.sendSettingsUpdate(id, { [key]: sanitized });
  }

  /** 应用退出前调用 */
  async shutdown(): Promise<void> {
    if (this.hostRestartTimer) {
      clearTimeout(this.hostRestartTimer);
      this.hostRestartTimer = null;
    }
    for (const rt of this.runtimes.values()) rt.hostSession?.abort();
    pluginHost.shutdown();
    await shutdownPluginStorage();
  }
}

export const pluginRegistry = new PluginRegistry();
