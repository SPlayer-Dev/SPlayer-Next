/**
 * 应用错误码
 *
 * 主进程通过 `classifyError()` 将原始异常映射为错误码返回给前端，
 * 前端通过 `handleError()` 根据错误码查询策略（toast / retry / silent / reset）进行统一处理。
 * 错误码同时作为 i18n 的 key（`errors.{code}`），支持多语言展示。
 */
export enum ErrorCode {
  // 设备相关
  /** 未找到音频输出设备（耳机拔出、驱动异常等），策略：reset（重建播放器实例） */
  DEVICE_NOT_FOUND = "DEVICE_NOT_FOUND",
  /** 音频设备初始化失败（设备被占用、权限不足等），策略：reset */
  DEVICE_INIT_FAILED = "DEVICE_INIT_FAILED",

  // 文件相关
  /** 文件不存在或无法访问（路径错误、文件被删除、权限不足），策略：toast */
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  /** 文件中未找到音频流（非音频文件或容器损坏），策略：toast */
  FILE_NO_AUDIO_STREAM = "FILE_NO_AUDIO_STREAM",
  /** 音频解码失败（编码格式不支持、文件数据损坏），策略：toast */
  FILE_DECODE_ERROR = "FILE_DECODE_ERROR",
  /** 用户取消了文件选择对话框，策略：silent */
  FILE_NOT_SELECTED = "FILE_NOT_SELECTED",

  // 网络相关
  /** 网络连接失败（DNS 解析失败、服务器不可达、连接被拒绝），策略：retry */
  NETWORK_ERROR = "NETWORK_ERROR",
  /** 网络请求超时，策略：retry */
  NETWORK_TIMEOUT = "NETWORK_TIMEOUT",

  // 扫描相关
  /** 未配置扫描目录，策略：toast */
  SCAN_NO_DIRS = "SCAN_NO_DIRS",
  /** 扫描目录已存在（重复添加），策略：toast */
  SCAN_DIR_EXISTS = "SCAN_DIR_EXISTS",
  /** 扫描目录不存在（被删除或路径无效），策略：toast */
  SCAN_DIR_NOT_FOUND = "SCAN_DIR_NOT_FOUND",
  /** 用户取消了目录选择对话框，策略：silent */
  SCAN_DIR_NOT_SELECTED = "SCAN_DIR_NOT_SELECTED",

  // 通用
  /** 未知错误（无法分类的异常），策略：toast */
  UNKNOWN = "UNKNOWN",
}

/**
 * 错误处理策略
 * - `toast`：通过 i18n 翻译后以 toast 形式提示用户
 * - `retry`：自动重试（最多 {@link MAX_RETRY} 次），全部失败后执行 `onRetryFailed` 回调
 * - `silent`：静默忽略，不做任何提示（如用户主动取消操作）
 * - `reset`：toast 提示 + 主进程自动重建播放器实例（设备丢失场景）
 */
export type ErrorStrategy = "toast" | "retry" | "silent" | "reset";

/** 错误码 → 处理策略映射 */
export const errorStrategies: Record<ErrorCode, ErrorStrategy> = {
  [ErrorCode.DEVICE_NOT_FOUND]: "reset",
  [ErrorCode.DEVICE_INIT_FAILED]: "reset",
  [ErrorCode.FILE_NOT_FOUND]: "toast",
  [ErrorCode.FILE_NO_AUDIO_STREAM]: "toast",
  [ErrorCode.FILE_DECODE_ERROR]: "toast",
  [ErrorCode.FILE_NOT_SELECTED]: "silent",
  [ErrorCode.NETWORK_ERROR]: "retry",
  [ErrorCode.NETWORK_TIMEOUT]: "retry",
  [ErrorCode.SCAN_NO_DIRS]: "toast",
  [ErrorCode.SCAN_DIR_EXISTS]: "toast",
  [ErrorCode.SCAN_DIR_NOT_FOUND]: "toast",
  [ErrorCode.SCAN_DIR_NOT_SELECTED]: "silent",
  [ErrorCode.UNKNOWN]: "toast",
};

/** 自动重试最大次数 */
export const MAX_RETRY = 1;
