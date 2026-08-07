import type { Album, Artist, Playlist, Track } from "./player";

/** 支持的流媒体服务器类型 */
export type StreamingServerType =
  "subsonic" | "navidrome" | "opensubsonic" | "airsonic" | "gonic" | "lms" | "jellyfin" | "emby";

/** 服务器配置视图 */
export interface StreamingServerConfig {
  /** 唯一标识符 */
  id: string;
  /** 服务器显示名称 */
  name: string;
  /** 服务器类型 */
  type: StreamingServerType;
  /** 服务器地址 */
  url: string;
  /** 账号用户名 */
  username: string;
  /** 主进程是否已经保存密码 */
  hasPassword: boolean;
  /** 最后一次连接成功的时间戳（ms） */
  lastConnected?: number;
}

/** 主进程运行时完整服务器配置 */
export interface StreamingRuntimeConfig extends StreamingServerConfig {
  /** 明文密码 */
  password: string;
  /** 会话 Token */
  accessToken?: string;
  /** 用户 ID */
  userId?: string;
}

/** 服务器表单提交输入 */
export interface StreamingServerInput {
  /** 服务器显示名称 */
  name: string;
  /** 服务器类型 */
  type: StreamingServerType;
  /** 服务器地址 */
  url: string;
  /** 账号用户名 */
  username: string;
  /** 账号密码 */
  password: string;
}

/** 错误归类 */
export type StreamingErrorCode = "auth" | "network" | "protocol" | "unknown";

/** 连通性测试结果 */
export interface StreamingPingResult {
  /** 是否连通成功 */
  ok: boolean;
  /** 服务器版本号 */
  version?: string;
  /** 失败描述信息 */
  error?: string;
  /** 失败错误码 */
  code?: StreamingErrorCode;
}

/** 连接操作结果 */
export type StreamingConnectResult =
  | { ok: true; server: StreamingServerConfig }
  | { ok: false; error: string; code: StreamingErrorCode };

/** 列表请求通用参数 */
export interface StreamingListParams {
  /** 分页偏移量 */
  offset?: number;
  /** 单页限制条数 */
  limit?: number;
}

/** 搜索结果聚合 */
export interface StreamingSearchResult {
  /** 匹配的歌曲列表 */
  songs: Track[];
  /** 匹配的专辑列表 */
  albums: Album[];
  /** 匹配的歌手列表 */
  artists: Artist[];
}

/** 流媒体服务器媒体快照 */
export interface StreamingLibrarySnapshot {
  /** 全量歌曲列表 */
  songs: Track[];
  /** 全量专辑列表 */
  albums: Album[];
  /** 全量歌手列表 */
  artists: Artist[];
  /** 全量歌单列表 */
  playlists: Playlist[];
}

/** 渲染进程通过 contextBridge 调用的流媒体 API */
export interface StreamingApi {
  /**
   * 读取服务器配置和当前激活项
   * @returns 运行时服务器配置与激活服务器 ID
   */
  loadServers: () => Promise<{
    servers: StreamingServerConfig[];
    activeServerId: string | null;
  }>;
  /**
   * 新增服务器
   * @param input - 服务器表单
   * @returns 新服务器视图
   */
  addServer: (input: StreamingServerInput) => Promise<StreamingServerConfig>;
  /**
   * 更新服务器
   * @param serverId - 服务器 ID
   * @param input - 服务器表单
   * @returns 更新后的服务器视图
   */
  updateServer: (serverId: string, input: StreamingServerInput) => Promise<StreamingServerConfig>;
  /**
   * 删除服务器
   * @param serverId - 服务器 ID
   * @returns 删除完成
   */
  removeServer: (serverId: string) => Promise<void>;
  /**
   * 保存激活服务器
   * @param serverId - 激活服务器 ID
   * @returns 保存完成
   */
  setActiveServer: (serverId: string | null) => Promise<void>;
  /**
   * 测试服务器连接
   * @param input - 服务器表单
   * @param serverId - 编辑中的服务器 ID
   * @returns 连通性结果
   */
  testConnection: (input: StreamingServerInput, serverId?: string) => Promise<StreamingPingResult>;
  /**
   * 连接服务器
   * @param serverId - 服务器 ID
   * @returns 连接结果
   */
  connect: (serverId: string) => Promise<StreamingConnectResult>;
  /**
   * 断开服务器会话
   * @param serverId - 服务器 ID
   * @returns 断开完成
   */
  disconnect: (serverId: string) => Promise<void>;
  /**
   * 读取主进程 SQLite 媒体库快照
   * @param serverId - 服务器 ID
   * @returns 服务器的完整媒体库快照
   */
  getSnapshot: (serverId: string) => Promise<StreamingLibrarySnapshot>;
  /**
   * 启动后台同步
   * @param serverId - 服务器 ID
   * @param force - 是否忽略本次应用运行内的成功同步记录
   * @returns 是否启动了新任务
   */
  sync: (serverId: string, force?: boolean) => Promise<boolean>;
  /**
   * 订阅媒体库更新
   * @param callback - 收到更新的服务器 ID
   * @returns 取消订阅函数
   */
  onLibraryUpdated: (callback: (serverId: string) => void) => () => void;
  /**
   * 搜索主进程 SQLite 中的流媒体
   * @param serverId - 服务器 ID
   * @param query - 搜索关键词
   * @returns 歌曲、专辑和歌手搜索结果
   */
  search: (serverId: string, query: string) => Promise<StreamingSearchResult>;
  /**
   * 读取专辑歌曲
   * @param serverId - 服务器 ID
   * @param albumId - 服务端专辑 ID
   * @returns 专辑歌曲
   */
  getAlbumSongs: (serverId: string, albumId: string) => Promise<Track[]>;
  /**
   * 读取歌单歌曲
   * @param serverId - 服务器 ID
   * @param playlistId - 服务端歌单 ID
   * @returns 歌单歌曲
   */
  getPlaylistSongs: (serverId: string, playlistId: string) => Promise<Track[]>;
  /**
   * 读取歌手专辑
   * @param serverId - 服务器 ID
   * @param artistId - 服务端歌手 ID
   * @returns 歌手专辑
   */
  getArtistAlbums: (serverId: string, artistId: string) => Promise<Album[]>;
  /**
   * 读取歌手歌曲
   * @param serverId - 服务器 ID
   * @param artistId - 服务端歌手 ID
   * @returns 歌手歌曲
   */
  getArtistSongs: (serverId: string, artistId: string) => Promise<Track[]>;
  /**
   * 生成播放地址
   * @param serverId - 服务器 ID
   * @param trackId - 服务端歌曲 ID
   * @param playSessionId - 播放会话 ID
   * @returns 播放地址
   */
  getStreamUrl: (serverId: string, trackId: string, playSessionId?: string) => Promise<string>;
  /**
   * 读取流媒体歌词
   * @param serverId - 服务器 ID
   * @param trackId - 服务端歌曲 ID
   * @param hint - 旧 Subsonic 歌词端点使用的歌曲信息
   * @returns 原始歌词文本
   */
  getLyrics: (
    serverId: string,
    trackId: string,
    hint?: { artist?: string; title?: string },
  ) => Promise<string | null>;
}
