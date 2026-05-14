/**
 * 应用错误码
 *
 * 主进程在 catch 时根据调用上下文确定错误码返回给前端，
 * 前端通过 `handleError()` 查 i18n 翻译后 toast 提示。
 * 错误码同时作为 i18n 的 key（`errors.{code}`）。
 */
export enum ErrorCode {
  // 设备相关
  /** 未找到音频输出设备 */
  DEVICE_NOT_FOUND = "DEVICE_NOT_FOUND",
  /** 音频设备初始化失败 */
  DEVICE_INIT_FAILED = "DEVICE_INIT_FAILED",

  // 文件相关
  /** 文件不存在或无法访问 */
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  /** 文件中未找到音频流 */
  FILE_NO_AUDIO_STREAM = "FILE_NO_AUDIO_STREAM",
  /** 音频解码失败 */
  FILE_DECODE_ERROR = "FILE_DECODE_ERROR",
  /** 用户取消了文件选择 */
  FILE_NOT_SELECTED = "FILE_NOT_SELECTED",

  // 网络相关
  /** 网络连接失败 */
  NETWORK_ERROR = "NETWORK_ERROR",
  /** 网络请求超时 */
  NETWORK_TIMEOUT = "NETWORK_TIMEOUT",

  // 在线源相关
  /** 无法获取播放地址（API + 插件都失败） */
  URL_RESOLVE_FAILED = "URL_RESOLVE_FAILED",
  /** 未找到支持该平台的插件 */
  NO_PLUGIN_AVAILABLE = "NO_PLUGIN_AVAILABLE",

  // 扫描相关
  /** 未配置扫描目录 */
  SCAN_NO_DIRS = "SCAN_NO_DIRS",
  /** 扫描目录已存在 */
  SCAN_DIR_EXISTS = "SCAN_DIR_EXISTS",
  /** 扫描目录不存在 */
  SCAN_DIR_NOT_FOUND = "SCAN_DIR_NOT_FOUND",
  /** 用户取消了目录选择 */
  SCAN_DIR_NOT_SELECTED = "SCAN_DIR_NOT_SELECTED",

  // 通用
  /** 未知错误 */
  UNKNOWN = "UNKNOWN",
}
