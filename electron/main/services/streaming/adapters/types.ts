import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type {
  StreamingListParams,
  StreamingPingResult,
  StreamingRuntimeConfig,
} from "@shared/types/streaming";

/** 主进程流媒体协议适配器 */
export interface StreamingAdapter {
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
   * @returns 真实封面地址
   */
  getCoverUrl(config: StreamingRuntimeConfig, coverId: string, size: number): Promise<string>;
}
