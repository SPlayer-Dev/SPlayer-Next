/** K20 GT 歌词显示语言 */
export type K20GTLanguage = "original" | "translation" | "romanization";

/** K20 GT 持久化配置 */
export interface K20GTSettings {
  enabled: boolean;
  language: K20GTLanguage;
}

/** 音箱连接状态 */
export interface K20GTStatus {
  state: "disabled" | "connecting" | "connected" | "disconnected" | "error";
  error?: string;
}

/** 音箱设置页接口 */
export interface K20GTApi {
  /** 获取当前连接状态 */
  getStatus: () => Promise<K20GTStatus>;
  /** 重新连接音箱 */
  reconnect: () => Promise<void>;
  /**
   * 订阅连接状态
   * @param callback - 状态处理函数
   * @returns 解除监听函数
   */
  onStatus: (callback: (status: K20GTStatus) => void) => () => void;
}

/** 专用设备页面使用的最小预加载接口 */
export interface K20GTWorkerApi {
  /**
   * 上报设备连接状态
   * @param status - 最新设备状态
   */
  status: (status: K20GTStatus) => void;
  /**
   * 接收已编码的设备报文
   * @param callback - 报文处理函数
   * @returns 解除监听函数
   */
  onReport: (callback: (report: Uint8Array) => void) => () => void;
}
