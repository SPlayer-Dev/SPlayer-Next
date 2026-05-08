import type { Track, IpcResponse } from "./player";

/** 支持的流媒体服务器类型 */
export type StreamingServerType = "subsonic" | "navidrome" | "opensubsonic" | "jellyfin" | "emby";

/**
 * 服务器配置
 */
export interface StreamingServerConfig {
  /** crypto.randomUUID() */
  id: string;
  name: string;
  type: StreamingServerType;
  /** 服务器地址，规范化为不带尾斜杠 */
  url: string;
  username: string;
  /** 明文密码 */
  password: string;
  /** Jellyfin/Emby 鉴权后回填，过期时由 store 重新登录 */
  accessToken?: string;
  /** Jellyfin/Emby 鉴权后回填的用户 ID */
  userId?: string;
  /** 最后一次连接成功的时间戳（ms） */
  lastConnected?: number;
}

/** 添加/编辑表单提交时的 payload（id/token 由 store 生成、回填） */
export interface StreamingServerInput {
  name: string;
  type: StreamingServerType;
  url: string;
  username: string;
  password: string;
}

/** 连通性测试结果 */
export interface StreamingPingResult {
  ok: boolean;
  /** 服务器版本号 */
  version?: string;
  /** 失败描述 */
  error?: string;
}

/** Jellyfin/Emby 登录返回 */
export interface StreamingAuthResult {
  accessToken: string;
  userId: string;
}

/** 列表请求通用参数 */
export interface StreamingListParams {
  offset?: number;
  limit?: number;
}

/** 流媒体专辑（用于 CoverList） */
export interface StreamingAlbum {
  id: string;
  name: string;
  artist?: string;
  cover?: string;
  songCount?: number;
  year?: number;
}

/** 流媒体歌手（用于 CoverList） */
export interface StreamingArtist {
  id: string;
  name: string;
  avatar?: string;
  albumCount?: number;
}

/** 流媒体歌单（用于 CoverList） */
export interface StreamingPlaylist {
  id: string;
  name: string;
  cover?: string;
  description?: string;
  songCount?: number;
  owner?: string;
}

/** 搜索结果聚合 */
export interface StreamingSearchResult {
  songs: Track[];
  albums: StreamingAlbum[];
  artists: StreamingArtist[];
}

/**
 * 主进程暴露给渲染层的 streaming IPC 接口
 *
 * 仅一个职责：把远端封面 URL 拉成字节给 SMTC 用（系统媒体集成需要 Buffer）。
 * 其它流媒体操作（鉴权/浏览/搜索/歌词）都在渲染层 src/services/streaming 完成。
 */
export interface StreamingApi {
  fetchCoverBytes: (url: string) => Promise<IpcResponse<Buffer | null>>;
}
