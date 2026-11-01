import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type {
  StreamingListParams,
  StreamingPingResult,
  StreamingRuntimeConfig,
} from "@shared/types/streaming";

/** 主进程流媒体协议适配器 */
export interface StreamingAdapter {
  /**
   * 生成原始文件下载地址，由服务端检查下载权限
   * @param config - 已鉴权配置
   * @param trackId - 服务端歌曲 ID
   * @returns 原文件下载地址
   */
  getDownloadUrl(config: StreamingRuntimeConfig, trackId: string): Promise<string>;
  /**
   * 遍历协议特有的全量歌曲索引
   * @param config - 配置与取消信号
   * @returns 完整歌曲分页
   */
  scanSongs?(config: StreamingRuntimeConfig): AsyncGenerator<Track[]>;
  /**
   * 读取服务端收藏状态
   * @param config - 已鉴权配置
   * @param trackId - 服务端歌曲 ID
   * @returns 收藏状态
   */
  getFavorite(config: StreamingRuntimeConfig, trackId: string): Promise<boolean>;
  /**
   * 写入服务端收藏状态
   * @param config - 已鉴权配置
   * @param trackId - 服务端歌曲 ID
   * @param favorite - 目标状态
   * @returns 服务端确认的状态
   */
  setFavorite(config: StreamingRuntimeConfig, trackId: string, favorite: boolean): Promise<boolean>;
  /**
   * 准备单次播放的音频源
   * @param config - 已鉴权配置
   * @param trackId - 服务端歌曲 ID
   * @param sessionId - 独立播放会话 ID
   * @returns 音频源
   */
  preparePlayback(
    config: StreamingRuntimeConfig,
    trackId: string,
    sessionId: string,
  ): Promise<StreamingPlaybackSource>;
  /**
   * 上报原生播放事件
   * @param config - 已鉴权配置
   * @param report - 当前会话事件
   */
  reportPlayback(config: StreamingRuntimeConfig, report: StreamingPlaybackReport): Promise<void>;
  /**
   * 检查服务器连通性
   * @param config - 主进程服务器配置
   * @returns 连通性结果
   */
  ping(config: StreamingRuntimeConfig): Promise<StreamingPingResult>;
  /**
   * 分页读取歌曲列表
   * @param config - 主进程服务器配置
   * @param params - 分页参数
   * @returns 统一歌曲列表
   */
  listSongs(config: StreamingRuntimeConfig, params?: StreamingListParams): Promise<Track[]>;
  /**
   * 分页读取专辑列表
   * @param config - 主进程服务器配置
   * @param params - 分页参数
   * @returns 统一专辑列表
   */
  listAlbums(config: StreamingRuntimeConfig, params?: StreamingListParams): Promise<Album[]>;
  /**
   * 读取歌手列表
   * @param config - 主进程服务器配置
   * @returns 统一歌手列表
   */
  listArtists(config: StreamingRuntimeConfig): Promise<Artist[]>;
  /**
   * 读取歌单列表
   * @param config - 主进程服务器配置
   * @returns 统一歌单列表
   */
  listPlaylists(config: StreamingRuntimeConfig): Promise<Playlist[]>;
  /**
   * 读取专辑歌曲
   * @param config - 主进程服务器配置
   * @param albumId - 服务端专辑 ID
   * @returns 按服务端顺序排列的歌曲
   */
  getAlbumSongs(config: StreamingRuntimeConfig, albumId: string): Promise<Track[]>;
  /**
   * 读取歌单歌曲
   * @param config - 主进程服务器配置
   * @param playlistId - 服务端歌单 ID
   * @returns 按歌单顺序排列的歌曲
   */
  getPlaylistSongs(config: StreamingRuntimeConfig, playlistId: string): Promise<Track[]>;
  /**
   * 读取歌手专辑
   * @param config - 主进程服务器配置
   * @param artistId - 服务端歌手 ID
   * @returns 歌手的专辑列表
   */
  getArtistAlbums(config: StreamingRuntimeConfig, artistId: string): Promise<Album[]>;
  /**
   * 读取歌手歌曲
   * @param config - 主进程服务器配置
   * @param artistId - 服务端歌手 ID
   * @returns 歌手的歌曲列表
   */
  getArtistSongs(config: StreamingRuntimeConfig, artistId: string): Promise<Track[]>;
  /**
   * 生成歌曲播放地址
   * @param config - 主进程服务器配置
   * @param trackId - 服务端歌曲 ID
   * @param playSessionId - 播放会话 ID
   * @returns 播放地址
   */
  getStreamUrl(
    config: StreamingRuntimeConfig,
    trackId: string,
    playSessionId?: string,
  ): Promise<string>;
  /**
   * 读取歌曲歌词
   * @param config - 主进程服务器配置
   * @param trackId - 服务端歌曲 ID
   * @param hint - 旧 Subsonic 歌词端点使用的歌曲信息
   * @returns 原始歌词文本
   */
  getLyrics(
    config: StreamingRuntimeConfig,
    trackId: string,
    hint?: { artist?: string; title?: string },
  ): Promise<string | null>;
  /**
   * 生成带主进程鉴权的真实封面地址
   * @param config - 主进程服务器配置
   * @param coverId - 服务端封面 ID
   * @param size - 目标尺寸
   * @param tag - 服务端封面版本标识
   * @returns 真实封面地址
   */
  getCoverUrl(
    config: StreamingRuntimeConfig,
    coverId: string,
    size: number,
    tag?: string,
  ): Promise<string>;
}

export interface StreamingPlaybackSource {
  url: string;
  mediaSourceId?: string;
}

/** 原生播放生命周期产生的上报；下载和预加载不进入此流程 */
export interface StreamingPlaybackReport {
  reason?: "TimeUpdate" | "Pause" | "Unpause";
  event: "start" | "progress" | "stop" | "scrobble";
  trackId: string;
  sessionId: string;
  mediaSourceId?: string;
  positionMs: number;
  paused: boolean;
  startedAt: number;
}
