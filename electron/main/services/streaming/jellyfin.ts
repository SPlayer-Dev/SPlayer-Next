import { randomBytes } from "node:crypto";
import type { StreamingPingResult, StreamingServerConfig } from "@shared/types/streaming";
import { decrypt } from "./auth";
import { streamingLog as log } from "../../utils/logger";

const CLIENT_NAME = "SPlayer-Next";
const CLIENT_VERSION = "1.0.0";
const DEVICE_NAME = "SPlayer Desktop";
const REQUEST_TIMEOUT = 15000;

/** 设备 ID：进程级稳定，重启后变化（Jellyfin 用作播放历史归并） */
let deviceIdCache: string | null = null;
const deviceId = (): string => {
  if (!deviceIdCache) deviceIdCache = `splayer-next-${randomBytes(8).toString("hex")}`;
  return deviceIdCache;
};

const baseUrl = (cfg: StreamingServerConfig): string => cfg.url.replace(/\/+$/, "");

/** Jellyfin 的鉴权头格式 */
const authHeader = (cfg: StreamingServerConfig): string => {
  const parts = [
    `Client="${CLIENT_NAME}"`,
    `Device="${DEVICE_NAME}"`,
    `DeviceId="${deviceId()}"`,
    `Version="${CLIENT_VERSION}"`,
  ];
  if (cfg.accessToken) parts.push(`Token="${cfg.accessToken}"`);
  return `MediaBrowser ${parts.join(", ")}`;
};

const fetchJson = async (
  url: string,
  init: RequestInit,
  timeout = REQUEST_TIMEOUT,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * 用账号密码换 accessToken / userId。
 * 调用方负责把返回值持久化到 config 上。
 */
export const authenticate = async (
  cfg: StreamingServerConfig,
): Promise<{ accessToken: string; userId: string }> => {
  const password = decrypt(cfg.passwordEncrypted);
  const res = await fetchJson(`${baseUrl(cfg)}/Users/AuthenticateByName`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // 此时 cfg.accessToken 通常为空，authHeader 不附带 Token
      "X-Emby-Authorization": authHeader(cfg),
    },
    body: JSON.stringify({ Username: cfg.username, Pw: password }),
  });
  if (!res.ok) throw new Error(`登录失败 HTTP ${res.status}`);
  const json = (await res.json()) as { AccessToken?: string; User?: { Id?: string } };
  const accessToken = json.AccessToken;
  const userId = json.User?.Id;
  if (!accessToken || !userId) throw new Error("登录响应缺少 AccessToken/UserId");
  return { accessToken, userId };
};

/** 服务器探活（不需要 token） */
export const ping = async (cfg: StreamingServerConfig): Promise<StreamingPingResult> => {
  try {
    const res = await fetchJson(`${baseUrl(cfg)}/System/Info/Public`, { method: "GET" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { Version?: string };
    return { ok: true, version: json.Version };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`jellyfin ping 失败 [${cfg.url}]:`, msg);
    return { ok: false, error: msg };
  }
};

/**
 * 构造音频流 URL。token 走 query 参数，便于 audio-engine 直接消费。
 * universal 端点会按客户端 capabilities 决定直出还是转码；这里默认请求直出。
 */
export const getStreamUrl = (cfg: StreamingServerConfig, originalId: string): string => {
  if (!cfg.accessToken) {
    throw new Error("缺少 accessToken，需要先 authenticate");
  }
  const params = new URLSearchParams({
    UserId: cfg.userId ?? "",
    DeviceId: deviceId(),
    api_key: cfg.accessToken,
    // 直出：不指定 AudioCodec/MaxStreamingBitrate，让服务器返回原始流
    Static: "true",
  });
  return `${baseUrl(cfg)}/Audio/${originalId}/universal?${params.toString()}`;
};

/**
 * 获取歌词。Jellyfin 10.8+ 提供 /Audio/{id}/Lyrics。
 * 旧版本或无歌词时返回 null。
 */
export const getLyrics = async (
  cfg: StreamingServerConfig,
  originalId: string,
): Promise<string | null> => {
  if (!cfg.accessToken) return null;
  try {
    const res = await fetchJson(`${baseUrl(cfg)}/Audio/${originalId}/Lyrics`, {
      method: "GET",
      headers: { "X-Emby-Authorization": authHeader(cfg) },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      Lyrics?: { Start?: number; Text: string }[];
    };
    const lines = json.Lyrics ?? [];
    if (lines.length === 0) return null;
    // Jellyfin 时间戳单位是 100ns ticks
    return lines
      .map((l) => {
        const ms = Math.max(0, Math.floor((l.Start ?? 0) / 10000));
        const mm = Math.floor(ms / 60000);
        const ss = Math.floor((ms % 60000) / 1000);
        const xx = Math.floor((ms % 1000) / 10);
        const ts = `[${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(xx).padStart(2, "0")}]`;
        return `${ts}${l.Text ?? ""}`;
      })
      .join("\n");
  } catch (err) {
    log.debug("jellyfin getLyrics 失败", err);
    return null;
  }
};
