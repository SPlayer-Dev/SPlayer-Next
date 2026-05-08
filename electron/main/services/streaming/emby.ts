/**
 * Emby 服务客户端。
 * Emby 与 Jellyfin 的 REST API 高度兼容（鉴权流程、资源端点几乎一致），
 * 这里直接复用 jellyfin.ts 的 ping/authenticate/getLyrics，仅在 stream URL
 * 端点选择上做微调（Emby 习惯用 /Audio/{id}/stream，universal 也通常可用）。
 */
import type { StreamingServerConfig } from "@shared/types/streaming";

export { ping, authenticate, getLyrics } from "./jellyfin";

const baseUrl = (cfg: StreamingServerConfig): string => cfg.url.replace(/\/+$/, "");

export const getStreamUrl = (cfg: StreamingServerConfig, originalId: string): string => {
  if (!cfg.accessToken) {
    throw new Error("缺少 accessToken，需要先 authenticate");
  }
  const params = new URLSearchParams({
    UserId: cfg.userId ?? "",
    api_key: cfg.accessToken,
    Static: "true",
  });
  return `${baseUrl(cfg)}/Audio/${originalId}/stream?${params.toString()}`;
};
