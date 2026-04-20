import type { PluginsConfig } from "../types/plugin";

/** 当前 Host API 级别；插件 `@apiLevel` 必须 ≤ 此值才加载 */
export const HOST_API_LEVEL = 1;

/** 各动作的默认超时（毫秒） */
export const ACTION_TIMEOUTS = {
  musicUrl: 20_000,
  lyric: 15_000,
  pic: 15_000,
} as const;

/** 网络请求最大超时 */
export const REQUEST_MAX_TIMEOUT = 60_000;

/** 网络请求默认超时 */
export const REQUEST_DEFAULT_TIMEOUT = 15_000;

/** 插件加载超时（从 fork 到收到 ready） */
export const PLUGIN_LOAD_TIMEOUT = 10_000;

/** 在线导入脚本大小上限（字节） */
export const INSTALL_URL_MAX_SIZE = 9_000_000;

/** 在线导入请求超时（毫秒） */
export const INSTALL_URL_TIMEOUT = 15_000;

/** 心跳间隔 */
export const HEARTBEAT_INTERVAL = 10_000;

/** 连续多少次未收到 pong 视为卡死 */
export const HEARTBEAT_MAX_MISSES = 3;

/** 自动重启次数 */
export const RESTART_MAX_ATTEMPTS = 3;

/** 每插件并发上限 */
export const PER_PLUGIN_CONCURRENCY = 4;

/** 错误码 */
export const PluginErrorCodes = {
  /** 未知错误 */
  UNKNOWN: "PLUGIN_UNKNOWN",
  /** 插件未找到 */
  NOT_FOUND: "PLUGIN_NOT_FOUND",
  /** 插件已禁用 */
  DISABLED: "PLUGIN_DISABLED",
  /** 插件未就绪 */
  NOT_READY: "PLUGIN_NOT_READY",
  /** 插件未注册该动作 */
  ACTION_UNSUPPORTED: "PLUGIN_ACTION_UNSUPPORTED",
  /** 加载超时 */
  LOAD_TIMEOUT: "PLUGIN_LOAD_TIMEOUT",
  /** 脚本语法错误或执行错误 */
  SCRIPT_ERROR: "PLUGIN_SCRIPT_ERROR",
  /** 元数据校验失败 */
  INVALID_MANIFEST: "PLUGIN_INVALID_MANIFEST",
  /** API level 不兼容 */
  API_LEVEL_MISMATCH: "PLUGIN_API_LEVEL_MISMATCH",
  /** 请求超时 */
  REQUEST_TIMEOUT: "PLUGIN_REQUEST_TIMEOUT",
  /** 请求被取消 */
  CANCELLED: "PLUGIN_CANCELLED",
  /** 网络错误 */
  NETWORK_ERROR: "PLUGIN_NETWORK_ERROR",
  /** URL 协议不允许 */
  URL_NOT_ALLOWED: "PLUGIN_URL_NOT_ALLOWED",
  /** 处理器抛出异常 */
  HANDLER_ERROR: "PLUGIN_HANDLER_ERROR",
  /** 子进程崩溃 */
  WORKER_CRASHED: "PLUGIN_WORKER_CRASHED",
} as const;

/** 默认插件配置 */
export const defaultPluginsConfig: PluginsConfig = {
  enabled: {},
  priority: {
    musicUrl: [],
    lyric: [],
    pic: [],
  },
  perPlugin: {},
};
