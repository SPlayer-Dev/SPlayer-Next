import type { UpdateChannel } from "./settings";

/** 应用更新阶段，由主进程统一管理 */
export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "cancelling"
  | "downloaded"
  | "installing"
  | "upToDate"
  | "error";

export interface UpdateMeta {
  version: string;
  releaseNotes: string;
  releaseDate: string;
  size: number;
  /** 检查结果对应的发布页，不随之后的通道变更推断 */
  releaseUrl: string;
}

/** 当前安装形式支持的更新方式 */
export type UpdateMode = "inApp" | "external" | "store";
export type UpdateErrorSource = "check" | "download" | "install";

/** 可恢复的完整更新快照，不包含安装包或下载器对象 */
export interface UpdateState {
  revision: number;
  channel: UpdateChannel;
  phase: UpdatePhase;
  mode: UpdateMode;
  meta: UpdateMeta | null;
  percent: number;
  error: { source: UpdateErrorSource; message: string } | null;
}

export interface UpdateEvent {
  state: UpdateState;
  notification?: "available" | "upToDate" | "downloaded" | "error";
  manual?: boolean;
}

export interface UpdateApi {
  getState: () => Promise<UpdateState>;
  check: (manual: boolean) => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  install: () => Promise<UpdateState>;
  openDownloadPage: () => Promise<void>;
  onEvent: (callback: (event: UpdateEvent) => void) => () => void;
}
