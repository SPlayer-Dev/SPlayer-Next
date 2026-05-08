/**
 * 流媒体服务模块统一入口。
 * 按 cfg.type 路由到对应实现。
 */
import type {
  StreamingPingResult,
  StreamingServerConfig,
  StreamingServerType,
} from "@shared/types/streaming";
import * as subsonic from "./subsonic";
import * as jellyfin from "./jellyfin";
import * as emby from "./emby";

/** 是否走 Subsonic 协议（subsonic / navidrome / opensubsonic） */
const isSubsonic = (type: StreamingServerType): boolean =>
  type === "subsonic" || type === "navidrome" || type === "opensubsonic";

/** 是否需要 accessToken 鉴权（jellyfin/emby） */
export const needsAccessToken = (type: StreamingServerType): boolean =>
  type === "jellyfin" || type === "emby";

/** 连通性测试 */
export const ping = (cfg: StreamingServerConfig): Promise<StreamingPingResult> => {
  if (isSubsonic(cfg.type)) return subsonic.ping(cfg);
  if (cfg.type === "jellyfin") return jellyfin.ping(cfg);
  if (cfg.type === "emby") return emby.ping(cfg);
  return Promise.resolve({ ok: false, error: `不支持的服务器类型: ${cfg.type}` });
};

/**
 * Jellyfin/Emby 的密码登录。Subsonic 系不需要，调用方应当先用 needsAccessToken 判断。
 * 返回值需要由调用方持久化到 config 上。
 */
export const authenticate = async (
  cfg: StreamingServerConfig,
): Promise<{ accessToken: string; userId: string }> => {
  if (cfg.type === "jellyfin") return jellyfin.authenticate(cfg);
  if (cfg.type === "emby") return emby.authenticate(cfg);
  throw new Error(`${cfg.type} 不需要 accessToken 鉴权`);
};

/** 构造可直接喂给 audio-engine 的播放 URL */
export const getStreamUrl = (cfg: StreamingServerConfig, originalId: string): string => {
  if (isSubsonic(cfg.type)) return subsonic.getStreamUrl(cfg, originalId);
  if (cfg.type === "jellyfin") return jellyfin.getStreamUrl(cfg, originalId);
  if (cfg.type === "emby") return emby.getStreamUrl(cfg, originalId);
  throw new Error(`不支持的服务器类型: ${cfg.type}`);
};

/** 取流媒体歌词；不可用一律返回 null（由上层走兜底） */
export const getLyrics = async (
  cfg: StreamingServerConfig,
  originalId: string,
  hint?: { artist?: string; title?: string },
): Promise<string | null> => {
  if (isSubsonic(cfg.type)) return subsonic.getLyrics(cfg, originalId, hint);
  if (cfg.type === "jellyfin") return jellyfin.getLyrics(cfg, originalId);
  if (cfg.type === "emby") return emby.getLyrics(cfg, originalId);
  return null;
};
