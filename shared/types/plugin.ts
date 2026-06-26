/**
 * 插件系统共享类型
 * 用于主进程、预加载、渲染进程、沙箱子进程之间的契约
 */

import type { LyricLine } from "./lyrics";

/**
 * 支持的插件动作
 * 当前仅有 musicUrl。扩展新动作的步骤：
 * 1. 在此 union 追加字面量；2. 补 `ActionIO` 映射；3. 补 `ACTION_TIMEOUTS` / `PluginsConfig.priority`；
 * 4. router 加入相应入口；其余（HostApi.on / handlers Map / SandboxIn.call）已泛型化，无需改动。
 */
export type PluginAction = "musicUrl";

/**
 * 音质等级
 * 对齐 src/utils/quality.ts 的 QualityLevel（去掉 null），保持宿主与插件一致
 * - hi-res：高解析度无损（采样率 ≥ 96kHz + 位深 ≥ 24bit）
 * - lossless：无损（flac/ape/wav 等）
 * - hq：有损 ≥ 320kbps
 * - sq：有损 ≥ 192kbps
 * - lq：有损 < 192kbps
 */
export type PluginQuality = "hi-res" | "lossless" | "hq" | "sq" | "lq";

/** 插件脚本来源平台（用于识别 lx 脚本并启用垫片） */
export type PluginPlatform = "splayer" | "lx";

/** 插件类型清单：运行时校验与分类的唯一来源，新增类型只改这里 */
export const PLUGIN_TYPES = ["source", "control"] as const;
/** 插件类型：音源（解析 URL）/ 控制（监听状态 + 反向控制） */
export type PluginType = (typeof PLUGIN_TYPES)[number];

/** 控制类插件可订阅的高层播放事件 */
export type PlaybackEventKind = "trackChange" | "lyricChange" | "lineChange" | "playStateChange";

/** 各高层事件的载荷 */
export interface PlaybackEventData {
  trackChange: {
    track: {
      title: string;
      artists: string;
      album?: string;
      duration: number;
      cover?: string;
    } | null;
  };
  /** 歌词数据 */
  lyricChange: { lines: LyricLine[] };
  /** 当前行索引变化 */
  lineChange: { index: number; position: number };
  /** 播放态变化 */
  playStateChange: { state: "playing" | "paused" | "stopped"; position: number };
}

/** 控制类插件注册的配置项类型（安全子集） */
export type PluginSettingType = "switch" | "number" | "text" | "select";

/** 控制类插件注册的单个配置项 */
export interface PluginSettingItem {
  key: string;
  type: PluginSettingType;
  /** 纯字符串展示名，不做多语言 */
  label: string;
  description?: string;
  default: boolean | number | string;
  /** number 专用 */
  min?: number;
  max?: number;
  /** text 专用 */
  placeholder?: string;
  /** select 专用 */
  options?: { label: string; value: string }[];
}

/** register 入参：音源类用 sources，控制类用 events/controls/settings */
export interface RegisterArgs {
  sources?: Record<string, SourceCapability>;
  events?: PlaybackEventKind[];
  controls?: boolean;
  settings?: PluginSettingItem[];
}

/** 控制类插件可用的播放面 */
export interface PluginPlayerApi {
  on<K extends PlaybackEventKind>(kind: K, handler: (data: PlaybackEventData[K]) => void): void;
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(positionMs: number): void;
  setVolume(volume: number): void;
  getPosition(): Promise<number>;
}

/** 插件头部 JSDoc 元数据 */
export interface PluginManifest {
  /** 插件唯一 ID = name + sha1(source).slice(0,8) */
  id: string;
  /** 展示名 */
  name: string;
  /** 版本号 */
  version: string;
  /** 简介 */
  description?: string;
  /** 作者 */
  author?: string;
  /** 主页 */
  homepage?: string;
  /** 脚本平台 */
  platform: PluginPlatform;
  /** 插件类型，来自 @type 头，缺省 "source" */
  type?: PluginType;
  /** 声明兼容的 Host API 级别 */
  apiLevel: number;
  /** 源码 SHA1 */
  hash: string;
  /** 安装时间戳（ms） */
  installedAt: number;
  /** 脚本相对 `{userData}/app-data/plugins/scripts/` 的文件名 */
  fileName: string;
}

/** 单个源（如 kw/kg）的能力声明 */
export interface SourceCapability {
  /** 展示名 */
  name: string;
  /** 支持的动作 */
  actions: PluginAction[];
  /** 支持的音质 */
  qualities?: PluginQuality[];
}

/** 插件运行状态 */
export type PluginStatus =
  | { state: "unloaded" }
  | { state: "loading" }
  | {
      state: "ready";
      sources: Record<string, SourceCapability>;
      /** 控制类附加信息（音源类为 undefined） */
      events?: PlaybackEventKind[];
      controls?: boolean;
      settings?: PluginSettingItem[];
    }
  | { state: "error"; error: { code: string; message: string } }
  | { state: "disabled" };

/** 插件脚本自己上报的更新信息 */
export interface PluginUpdateInfo {
  /** 新版本号（若脚本提供） */
  version?: string;
  /** 人类可读的更新说明 */
  log?: string;
  /** 新版本下载/介绍页链接 */
  updateUrl?: string;
  /** 收到更新提示的时间戳（ms） */
  updatedAt: number;
}

/** 渲染端看到的插件条目（manifest + 状态） */
export interface PluginInfo {
  manifest: PluginManifest;
  enabled: boolean;
  status: PluginStatus;
  /** 脚本上报过"有新版本"时填充，用户更新/卸载后清空 */
  updateInfo?: PluginUpdateInfo | null;
  /** 控制类插件的当前设置值 */
  settingsValues?: Record<string, unknown>;
}

/* ========== 调用请求 / 响应 ========== */

export interface MusicUrlReq {
  source: string;
  quality: PluginQuality;
  musicInfo: {
    songmid: string;
    name?: string;
    singer?: string;
    [key: string]: unknown;
  };
}
export interface MusicUrlRes {
  url: string;
  quality?: PluginQuality;
  expire?: number;
}

/** Action → 请求/响应映射，用于 HostApi.on 的重载。新增动作时在此追加。 */
export interface ActionIO {
  musicUrl: { req: MusicUrlReq; res: MusicUrlRes };
}

/* ========== 宿主暴露给插件的 API（在沙箱内注入为 globalThis.splayer） ========== */

export interface HostRequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | ArrayBuffer | Uint8Array;
  /** 毫秒，默认 15000，最大 60000 */
  timeout?: number;
  /** 默认 text；arraybuffer 返回 Uint8Array */
  responseType?: "text" | "json" | "arraybuffer";
}

export interface HostRequestResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface HostLogger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface HostStorage {
  get: <T = unknown>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
  keys: () => Promise<string[]>;
}

/** 注入沙箱的全局对象形状 */
export interface HostApi {
  readonly pluginId: string;
  readonly apiLevel: number;
  readonly locale: string;
  readonly appVersion: string;

  /** 发起网络请求 */
  request: (url: string, opts?: HostRequestOptions) => Promise<HostRequestResult>;

  /** 声明能力：音源类传 sources，控制类传 events/controls/settings */
  register: (args: RegisterArgs) => void;

  /** 注册动作处理器 */
  on: <A extends PluginAction>(
    action: A,
    handler: (req: ActionIO[A]["req"]) => Promise<ActionIO[A]["res"]>,
  ) => void;

  /** 日志 */
  log: HostLogger;

  /** 每插件隔离 KV */
  storage: HostStorage;

  /** 用户在设置里为此插件配置的值 */
  getSetting: <T = unknown>(key: string) => T | undefined;

  /** 控制类播放面：监听高层事件 + 反向控制 */
  player: PluginPlayerApi;

  /** 控制类设置变更回调：用户改设置后触发 */
  onSettingChange: (key: string, handler: (value: unknown) => void) => void;
}

/* ========== 沙箱 ↔ 主进程消息协议 ========== */

export interface PluginErrorPayload {
  code: string;
  message: string;
}

/** 主 → worker */
export type SandboxIn =
  | {
      kind: "init";
      pluginId: string;
      apiLevel: number;
      locale: string;
      appVersion: string;
      platform: PluginPlatform;
      userSettings: Record<string, unknown>;
      source: string;
      scriptInfo: {
        name: string;
        description: string;
        version: string;
        author: string;
        homepage: string;
      };
    }
  | { kind: "call"; requestId: string; action: PluginAction; params: unknown }
  | { kind: "cancel"; requestId: string }
  | {
      kind: "hostResult";
      callId: string;
      ok: boolean;
      data?: unknown;
      error?: PluginErrorPayload;
    }
  | { kind: "ping" }
  | { kind: "event"; event: PlaybackEventKind; data: unknown }
  | { kind: "settingsUpdate"; settings: Record<string, unknown> };

/** worker → 主 */
export type SandboxOut =
  | { kind: "ready"; sources: Record<string, SourceCapability> }
  | {
      kind: "result";
      requestId: string;
      ok: boolean;
      data?: unknown;
      error?: PluginErrorPayload;
    }
  | { kind: "hostCall"; callId: string; method: HostCallMethod; args: unknown[] }
  | { kind: "updateAvailable"; info: PluginUpdateInfo }
  | {
      kind: "log";
      level: "debug" | "info" | "warn" | "error";
      args: unknown[];
    }
  | { kind: "fatal"; error: PluginErrorPayload }
  | { kind: "pong" }
  /** sources 增量上报 */
  | { kind: "sourcesUpdate"; sources: Record<string, SourceCapability> }
  /** 控制类注册上报：声明订阅事件 / 是否反向控制 / 设置项 */
  | {
      kind: "registered";
      events: PlaybackEventKind[];
      controls: boolean;
      settings: PluginSettingItem[];
    };

/** worker 调用回宿主的方法名 */
export type HostCallMethod =
  | "request"
  | "storage.get"
  | "storage.set"
  | "storage.remove"
  | "storage.keys"
  | "player.play"
  | "player.pause"
  | "player.next"
  | "player.prev"
  | "player.seek"
  | "player.setVolume"
  | "player.getPosition";

/* ========== 渲染端 ↔ 主进程的 IPC 请求参数 ========== */

export interface PluginResolveUrlArgs {
  pluginId: string;
  source: string;
  quality?: PluginQuality;
  musicInfo: { songmid: string; [key: string]: unknown };
}

/** 渲染端插件 API */
export interface PluginsApi {
  /** 列出所有已安装插件 */
  list: () => Promise<PluginInfo[]>;
  /** 从指定路径导入插件（进阶：一般由 pickAndInstall 触发） */
  install: (filePath: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
  /** 弹出原生文件选择框导入插件 */
  pickAndInstall: () => Promise<{
    ok: boolean;
    id?: string;
    error?: string;
    cancelled?: boolean;
  }>;
  /** 从远端 URL 下载并导入 */
  installFromUrl: (url: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
  /** 卸载（同时删除 scripts/{id}.js） */
  uninstall: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** 启用/禁用 */
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /**
   * 写入控制类插件的单个配置项
   * @param id - 插件 ID
   * @param key - 配置项 key（须在插件 settings schema 中声明）
   * @param value - 新值，由主进程按 schema 类型校验后写入并推送到沙箱
   */
  setSetting: (id: string, key: string, value: unknown) => Promise<void>;
  /** 获取播放 URL */
  resolveUrl: (args: PluginResolveUrlArgs) => Promise<MusicUrlRes>;
  /** 订阅插件状态变化 */
  onStatus: (cb: (info: PluginInfo) => void) => () => void;
}

/* ========== 配置 ========== */

export interface PluginsConfig {
  /** 插件启用开关，key = pluginId */
  enabled: Record<string, boolean>;
  /** 各动作的插件优先级列表 */
  priority: {
    musicUrl: string[];
  };
  /** 每插件的用户设置 */
  perPlugin: Record<string, Record<string, unknown>>;
}
