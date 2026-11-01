/** 允许上传的音频扩展名 */
export const AUDIO_EXTENSIONS: string[] = [
  "mp3",
  "flac",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "wma",
  "ape",
  "aiff",
];

/** 选中待上传的本地歌曲 */
export interface PickedSong {
  /** 绝对路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 字节大小 */
  size: number;
}

/** 上传阶段 */
export type CloudUploadStage = "checking" | "uploading" | "finishing";

/** 单首上传进度事件 */
export interface CloudUploadProgress {
  /** 队列项 id */
  uploadId: string;
  stage: CloudUploadStage;
  /** 已传字节 */
  loaded: number;
  /** 文件总字节 */
  total: number;
}

/** 单首上传结果 */
export interface CloudUploadResult {
  success: boolean;
  /** 是否秒传 */
  instant: boolean;
  /** 云盘歌曲 id */
  songId?: string;
  /** 失败时的 NCM 错误码 */
  errorCode?: number;
}

/** 渲染层 api */
export interface CloudUploadApi {
  /** 弹出文件选择器,返回选中歌曲的路径/名称/大小 */
  pickSongs: () => Promise<PickedSong[]>;
  /** 上传单首,过程中推送进度事件,返回最终结果 */
  uploadSong: (path: string, uploadId: string) => Promise<CloudUploadResult>;
  /** 订阅上传进度,返回取消订阅函数 */
  onUploadProgress: (callback: (progress: CloudUploadProgress) => void) => () => void;
}
