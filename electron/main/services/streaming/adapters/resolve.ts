import type { StreamingServerType } from "@shared/types/streaming";
import type { StreamingRuntimeConfig } from "@shared/types/streaming";
import { authenticate, jellyfinAdapter, type StreamingAuthSession } from "./jellyfin";
import { subsonicAdapter } from "./subsonic";
import type { StreamingAdapter } from "./types";

const SUBSONIC_TYPES = new Set<StreamingServerType>([
  "subsonic",
  "navidrome",
  "opensubsonic",
  "airsonic",
  "gonic",
  "lms",
]);
const MAX_SESSION_COUNT = 16;

const sessionCache = new Map<string, StreamingAuthSession>();
const pendingLogins = new Map<string, Promise<StreamingAuthSession>>();

/**
 * 清除指定服务器的主进程登录会话
 * @param serverId - 服务器 ID
 */
export const invalidateStreamingSession = (serverId: string): void => {
  sessionCache.delete(serverId);
  pendingLogins.delete(serverId);
};

export interface ResolvedStreamingAdapter {
  config: StreamingRuntimeConfig;
  adapter: StreamingAdapter;
}

/**
 * 保存有界主进程登录会话
 * @param serverId - 服务器 ID
 * @param session - 登录会话
 */
const cacheSession = (serverId: string, session: StreamingAuthSession): void => {
  sessionCache.delete(serverId);
  sessionCache.set(serverId, session);
  while (sessionCache.size > MAX_SESSION_COUNT) {
    const oldestServerId = sessionCache.keys().next().value as string;
    sessionCache.delete(oldestServerId);
  }
};

/**
 * 获取或创建 Jellyfin/Emby 主进程登录会话
 * @param config - 主进程服务器配置
 * @returns 可复用的登录会话
 */
const getSession = async (config: StreamingRuntimeConfig): Promise<StreamingAuthSession> => {
  const cached = sessionCache.get(config.id);
  if (cached) {
    sessionCache.delete(config.id);
    sessionCache.set(config.id, cached);
    return cached;
  }
  const pending = pendingLogins.get(config.id);
  if (pending) return pending;

  const promise = authenticate(config).then((session) => {
    if (pendingLogins.get(config.id) === promise) cacheSession(config.id, session);
    return session;
  });
  pendingLogins.set(config.id, promise);
  try {
    return await promise;
  } finally {
    if (pendingLogins.get(config.id) === promise) pendingLogins.delete(config.id);
  }
};

/**
 * 解析协议适配器，并为 Jellyfin/Emby 建立主进程会话
 * @param config - 带明文凭据的主进程配置
 * @returns 可直接发起请求的配置和适配器
 */
export const resolveStreamingAdapter = async (
  config: StreamingRuntimeConfig,
): Promise<ResolvedStreamingAdapter> => {
  if (SUBSONIC_TYPES.has(config.type)) return { config, adapter: subsonicAdapter };
  if (config.type === "jellyfin" || config.type === "emby") {
    const session = await getSession(config);
    return { config: { ...config, ...session }, adapter: jellyfinAdapter };
  }
  throw new Error(`不支持的服务器类型: ${config.type}`);
};
