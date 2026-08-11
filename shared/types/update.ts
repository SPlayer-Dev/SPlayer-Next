/** 应用更新阶段 */
export type UpdatePhase =
  "idle" | "checking" | "available" | "downloading" | "downloaded" | "upToDate" | "error";

/** 更新信息 */
export interface UpdateMeta {
  /** 新版本号 */
  version: string;
  /** release notes */
  releaseNotes: string;
  /** 发布日期（ISO 字符串） */
  releaseDate: string;
  /** 更新包大小（字节，0 表示未知） */
  size: number;
}

/** 主进程推送到渲染层的更新事件 */
export type UpdateEvent =
  | { type: "checking" }
  | { type: "available"; meta: UpdateMeta; manual: boolean; canInstall: boolean }
  | { type: "notAvailable"; manual: boolean }
  | { type: "progress"; percent: number }
  | { type: "downloaded"; meta: UpdateMeta }
  | { type: "error"; message: string; manual: boolean };

/** 更新模块对渲染层暴露的 API */
export interface UpdateApi {
  /** 检查更新 */
  check: (manual: boolean) => Promise<void>;
  /** 下载更新（Win/Linux） */
  download: () => Promise<void>;
  /** 退出并安装 */
  install: () => Promise<void>;
  /** 打开 Releases 下载页 */
  openDownloadPage: () => Promise<void>;
  /** 订阅更新事件，返回取消订阅函数 */
  onEvent: (callback: (event: UpdateEvent) => void) => () => void;
}
