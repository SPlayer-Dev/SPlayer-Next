import type { IpcResponse, Track } from "./player";

/** 扫描进度事件 */
export interface ScanProgress {
  phase: "scanning" | "done" | "error";
  /** 总文件数 */
  total: number;
  /** 已扫描文件数 */
  scanned: number;
  /** 当前正在处理的文件名 */
  current?: string;
  /** 错误信息（仅 error 阶段） */
  error?: string;
}

/** 通过 preload 暴露的音乐库 API */
export interface LibraryApi {
  scan: (incremental?: boolean) => Promise<IpcResponse>;
  cancelScan: () => Promise<IpcResponse>;
  getTracks: () => Promise<IpcResponse<Track[]>>;
  searchTracks: (query: string) => Promise<IpcResponse<Track[]>>;
  getTrackCount: () => Promise<IpcResponse<number>>;
  isScanning: () => Promise<IpcResponse<boolean>>;
  addScanDir: () => Promise<IpcResponse<string>>;
  removeScanDir: (dir: string) => Promise<IpcResponse>;
  getScanDirs: () => Promise<IpcResponse<string[]>>;
  onScanProgress: (callback: (progress: ScanProgress) => void) => () => void;
}
