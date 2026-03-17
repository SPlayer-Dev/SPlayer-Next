/** 歌手 */
export interface Artist {
  /** 平台 ID */
  id?: string;
  /** 歌手名 */
  name: string;
}

/** 专辑 */
export interface Album {
  /** 平台 ID */
  id?: string;
  /** 专辑名 */
  name: string;
}

/** 歌词格式 */
export type LyricFormat = "ttml" | "lys" | "yrc" | "qrc" | "eslrc" | "lrc";

/** 外部歌词文件 */
export interface ExternalLyric {
  /** 歌词格式 */
  format: LyricFormat;
  /** 歌词内容 */
  content: string;
}

/** 歌曲来源 */
export type TrackSource = "local" | "online";

/** 音质信息 */
export interface AudioQuality {
  /** 采样率 (Hz) */
  sampleRate: number;
  /** 声道数 */
  channels: number;
  /** 比特率 (bps) */
  bitRate: number;
  /** 编码格式（如 "flac", "mp3", "aac"） */
  codec: string;
}

/**
 * 歌曲
 * 轻量结构，放在播放列表中
 */
export interface Track {
  /** 唯一标识 */
  id: string;
  /** 来源类型 */
  source: TrackSource;
  /** 本地文件路径 */
  path?: string;
  /** 标题 */
  title: string;
  /** 歌手列表 */
  artists: Artist[];
  /** 专辑 */
  album?: Album;
  /** 时长（毫秒） */
  duration: number;
  /** 封面缩略图 URL（cover:// 或 http，用于列表/迷你播放器） */
  cover?: string;
  /** 封面原图 URL */
  coverOriginal?: string;
}

/**
 * 歌曲详细信息
 * 当前播放时才获取
 */
export interface TrackDetail {
  /** 音质信息 */
  quality: AudioQuality;
  /** 内嵌歌词 */
  embeddedLyric?: string;
  /** 同目录下找到的所有外部歌词文件 */
  externalLyrics: ExternalLyric[];
}
