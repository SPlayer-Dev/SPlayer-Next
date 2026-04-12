import type { IpcResponse, Track } from "./player";

/** 专辑聚合项 */
export interface AlbumSummary {
  name: string;
  cover?: string;
  artist: string;
  trackCount: number;
}

/** 歌手聚合项 */
export interface ArtistSummary {
  name: string;
  trackCount: number;
}

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

/** 音乐库 API */
export interface LibraryApi {
  /**
   * 开始扫描
   * @param incremental 是否增量扫描（跳过未变化的文件）
   */
  scan: (incremental?: boolean) => Promise<IpcResponse>;
  /** 取消扫描 */
  cancelScan: () => Promise<IpcResponse>;
  /** 获取全部曲目 */
  getTracks: () => Promise<IpcResponse<Track[]>>;
  /** 获取专辑聚合列表 */
  getAlbums: () => Promise<IpcResponse<AlbumSummary[]>>;
  /** 获取歌手聚合列表 */
  getArtists: () => Promise<IpcResponse<ArtistSummary[]>>;
  /** 获取某专辑下的全部曲目 */
  getAlbumTracks: (albumName: string) => Promise<IpcResponse<Track[]>>;
  /** 获取某歌手的全部曲目 */
  getArtistTracks: (artistName: string) => Promise<IpcResponse<Track[]>>;
  /** 按 ID 批量获取曲目 */
  getTracksByIds: (ids: string[]) => Promise<IpcResponse<Track[]>>;
  /** 搜索曲目 */
  searchTracks: (query: string) => Promise<IpcResponse<Track[]>>;
  /** 获取曲目总数 */
  getTrackCount: () => Promise<IpcResponse<number>>;
  /** 获取扫描状态 */
  isScanning: () => Promise<IpcResponse<boolean>>;
  /** 弹出目录选择器，添加扫描目录 */
  addScanDir: () => Promise<IpcResponse<string>>;
  /** 移除扫描目录及其下曲目 */
  removeScanDir: (dir: string) => Promise<IpcResponse>;
  /** 获取已配置的扫描目录 */
  getScanDirs: () => Promise<IpcResponse<string[]>>;
  /** 删除曲目文件并从数据库移除 */
  deleteTracks: (paths: string[]) => Promise<IpcResponse<{ deleted: number; failed: number }>>;
  /** 获取本地歌手头像 */
  fetchArtistAvatar: (artistName: string) => Promise<IpcResponse<string | null>>;
  /** 批量预取歌手头像 */
  prefetchArtistAvatars: (artistNames: string[]) => Promise<IpcResponse<Record<string, string>>>;
  /** 订阅扫描进度事件 */
  onScanProgress: (callback: (progress: ScanProgress) => void) => () => void;
}
