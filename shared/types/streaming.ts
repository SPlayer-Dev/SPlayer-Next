import type { Album, Artist, Track } from "./player";

/** 支持的流媒体服务器类型 */
export type StreamingServerType =
  | "subsonic"
  | "navidrome"
  | "opensubsonic"
  | "airsonic"
  | "gonic"
  | "lms"
  | "jellyfin"
  | "emby";

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
  /** Jellyfin/Emby 鉴权后回填 */
  accessToken?: string;
  /** Jellyfin/Emby 鉴权后回填的用户 ID */
  userId?: string;
  /** 最后一次连接成功的时间戳（ms） */
  lastConnected?: number;
}

/** 添加/编辑表单提交时的 payload */
export interface StreamingServerInput {
  name: string;
  type: StreamingServerType;
  url: string;
  username: string;
  password: string;
}

/** 错误归类 */
export type StreamingErrorCode = "auth" | "network" | "protocol" | "unknown";

/** 连通性测试结果 */
export interface StreamingPingResult {
  ok: boolean;
  /** 服务器版本号 */
  version?: string;
  /** 失败描述 */
  error?: string;
  /** 失败归类（仅 ok=false 时有意义） */
  code?: StreamingErrorCode;
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

/** 搜索结果聚合 */
export interface StreamingSearchResult {
  songs: Track[];
  albums: Album[];
  artists: Artist[];
}

/**
 * 主进程暴露给渲染层的 streaming IPC 接口
 * - loadServers / saveServers：服务器配置持久化，密码经 safeStorage 加密写入
 *   `{userData}/streaming.json`；accessToken/userId 不持久化
 */
export interface StreamingApi {
  loadServers: () => Promise<{
    servers: StreamingServerConfig[];
    activeServerId: string | null;
  }>;
  saveServers: (payload: {
    servers: StreamingServerConfig[];
    activeServerId: string | null;
  }) => Promise<void>;
}
