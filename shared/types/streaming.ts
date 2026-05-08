import type { IpcResponse, Track } from "./player";

/** 支持的媒体服务器类型 */
export type StreamingServerType =
  | "subsonic"
  | "navidrome"
  | "opensubsonic"
  | "jellyfin"
  | "emby";

/**
 * 完整服务器配置（持久化形态，密码已加密）
 * 仅在主进程内流转，不暴露给渲染进程
 */
export interface StreamingServerConfig {
  /** crypto.randomUUID() */
  id: string;
  name: string;
  type: StreamingServerType;
  /** 服务器地址，规范化为不带尾斜杠 */
  url: string;
  username: string;
  /** safeStorage 加密后 base64；不可用时退化为 base64 明文 */
  passwordEncrypted: string;
  /** Jellyfin/Emby 鉴权后回填，过期重新登录 */
  accessToken?: string;
  /** Jellyfin/Emby 鉴权后回填的用户 ID */
  userId?: string;
  /** 最后一次连接成功的时间戳（ms） */
  lastConnected?: number;
}

/** 渲染进程视图：剥离敏感字段 */
export interface StreamingServerSummary {
  id: string;
  name: string;
  type: StreamingServerType;
  url: string;
  username: string;
  /** 是否已持有有效 accessToken（仅 jellyfin/emby 用） */
  hasToken: boolean;
  lastConnected?: number;
}

/** 添加/更新/连通性测试时由渲染层提交的明文 payload */
export interface StreamingServerInput {
  name: string;
  type: StreamingServerType;
  url: string;
  username: string;
  /** 明文密码：通过 contextBridge 单次传入，主进程立即加密存盘 */
  password: string;
}

/** 连通性测试结果 */
export interface StreamingPingResult {
  ok: boolean;
  /** 服务器报告的版本号 */
  version?: string;
  /** 失败时的错误描述 */
  error?: string;
}

/** 流媒体相关 IPC */
export interface StreamingApi {
  /** 列出全部已配置的服务器（不含密码） */
  listServers: () => Promise<IpcResponse<StreamingServerSummary[]>>;
  /** 获取当前激活服务器 */
  getActiveServer: () => Promise<IpcResponse<StreamingServerSummary | null>>;
  /** 设置激活服务器；传 null 清除 */
  setActiveServer: (id: string | null) => Promise<IpcResponse>;
  /** 添加服务器，返回带 id 的 summary */
  addServer: (input: StreamingServerInput) => Promise<IpcResponse<StreamingServerSummary>>;
  /** 局部更新；password 字段为 undefined 时保留原密码 */
  updateServer: (
    id: string,
    patch: Partial<StreamingServerInput>,
  ) => Promise<IpcResponse<StreamingServerSummary>>;
  /** 移除服务器 */
  removeServer: (id: string) => Promise<IpcResponse>;
  /** 不写入配置的预飞行测试 */
  testConnection: (input: StreamingServerInput) => Promise<IpcResponse<StreamingPingResult>>;
  /** 解析 Track 为可直接喂给 player:load 的 URL（含鉴权参数） */
  resolveUrl: (track: Track) => Promise<IpcResponse<string>>;
  /** 取流媒体歌词（LRC 文本或 null） */
  getLyrics: (track: Track) => Promise<IpcResponse<string | null>>;
}
