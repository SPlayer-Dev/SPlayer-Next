/**
 * 插件系统共享类型
 * 用于主进程、预加载、渲染进程、沙箱子进程之间的契约
 */

/** 支持的插件动作 */
export type PluginAction = "search" | "musicUrl" | "lyric" | "pic" | "meta";

/** 音质等级 */
export type PluginQuality = "128k" | "320k" | "flac" | "hires";

/** 插件脚本来源平台（用于识别 lx 脚本并启用垫片） */
export type PluginPlatform = "splayer" | "lx";

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
  /** 声明兼容的 Host API 级别 */
  apiLevel: number;
  /** 源码 SHA1 */
  hash: string;
  /** 安装时间戳（ms） */
  installedAt: number;
  /** 脚本相对 `{userData}/plugins/scripts/` 的文件名 */
  fileName: string;
}

/** 单个源（如 kw/kg）的能力声明 */
export interface SourceCapability {
  /** 展示名 */
  name: string;
  /** 支持的动作 */
  actions: PluginAction[];
  /** 支持的音质（仅 music 类动作相关） */
  qualities?: PluginQuality[];
}

/** 插件运行状态 */
export type PluginStatus =
  | { state: "unloaded" }
  | { state: "loading" }
  | { state: "ready"; sources: Record<string, SourceCapability> }
  | { state: "error"; error: { code: string; message: string } }
  | { state: "disabled" };

/** 渲染端看到的插件条目（manifest + 状态） */
export interface PluginInfo {
  manifest: PluginManifest;
  enabled: boolean;
  status: PluginStatus;
}

/* ========== 调用请求 / 响应 ========== */

export interface SearchReq {
  source: string;
  keyword: string;
  page?: number;
  limit?: number;
}
export interface SearchTrackItem {
  songmid: string;
  name: string;
  singer: string;
  albumName?: string;
  interval?: string;
  cover?: string;
  qualities?: PluginQuality[];
}
export interface SearchRes {
  list: SearchTrackItem[];
  total?: number;
}

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

export interface LyricReq {
  source: string;
  musicInfo: {
    songmid: string;
    name?: string;
    singer?: string;
    [key: string]: unknown;
  };
}
export interface LyricRes {
  lyric: string;
  tlyric?: string | null;
  rlyric?: string | null;
  lxlyric?: string | null;
}

export interface PicReq {
  source: string;
  musicInfo: { songmid: string; [key: string]: unknown };
}
export interface PicRes {
  url: string;
}

export interface MetaReq {
  source: string;
  musicInfo: { songmid?: string; name: string; singer?: string; [key: string]: unknown };
}
export interface MetaRes {
  album?: string;
  cover?: string;
  year?: number;
  [key: string]: unknown;
}

/** Action → 请求/响应映射，用于 HostApi.on 的重载 */
export interface ActionIO {
  search: { req: SearchReq; res: SearchRes };
  musicUrl: { req: MusicUrlReq; res: MusicUrlRes };
  lyric: { req: LyricReq; res: LyricRes };
  pic: { req: PicReq; res: PicRes };
  meta: { req: MetaReq; res: MetaRes };
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

  /** 声明支持的源与动作 */
  register: (caps: { sources: Record<string, SourceCapability> }) => void;

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
  | { kind: "ping" };

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
  | {
      kind: "log";
      level: "debug" | "info" | "warn" | "error";
      args: unknown[];
    }
  | { kind: "fatal"; error: PluginErrorPayload }
  | { kind: "pong" };

/** worker 调用回宿主的方法名 */
export type HostCallMethod =
  | "request"
  | "storage.get"
  | "storage.set"
  | "storage.remove"
  | "storage.keys";

/* ========== 渲染端 ↔ 主进程的 IPC 请求参数 ========== */

export interface PluginSearchArgs {
  /** 不填则按 settings.plugins.priority.search 顺序尝试 */
  pluginId?: string;
  source?: string;
  keyword: string;
  page?: number;
  limit?: number;
}

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
  /** 卸载（同时删除 scripts/{id}.js） */
  uninstall: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** 启用/禁用 */
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** 搜索 */
  search: (args: PluginSearchArgs) => Promise<SearchRes>;
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
    search: string[];
    musicUrl: string[];
    lyric: string[];
    meta: string[];
  };
  /** 每插件的用户设置 */
  perPlugin: Record<string, Record<string, unknown>>;
}
