import { createHash, randomBytes } from "node:crypto";
import type { StreamingPingResult, StreamingServerConfig } from "@shared/types/streaming";
import { decrypt } from "./auth";
import { streamingLog as log } from "../../utils/logger";

/** Subsonic API 客户端版本号；必须 ≥ 服务器最低支持版本 */
const API_VERSION = "1.16.1";
/** 客户端标识，会出现在服务器播放历史中 */
const CLIENT_NAME = "SPlayer-Next";
/** 请求超时（毫秒） */
const REQUEST_TIMEOUT = 15000;

interface SubsonicAuthParams {
  u: string;
  t: string;
  s: string;
  v: string;
  c: string;
  f: string;
}

/** 生成随机 salt（12 字符 hex） */
const newSalt = (): string => randomBytes(6).toString("hex");

/** md5(password + salt) */
const md5Token = (password: string, salt: string): string =>
  createHash("md5").update(password + salt).digest("hex");

/** 标准化 baseUrl，去掉尾斜杠 */
const baseUrl = (cfg: StreamingServerConfig): string => cfg.url.replace(/\/+$/, "");

/** 生成本次请求的鉴权参数 */
const authParams = (cfg: StreamingServerConfig): SubsonicAuthParams => {
  const password = decrypt(cfg.passwordEncrypted);
  const salt = newSalt();
  return {
    u: cfg.username,
    t: md5Token(password, salt),
    s: salt,
    v: API_VERSION,
    c: CLIENT_NAME,
    f: "json",
  };
};

/** 拼接带鉴权参数的完整 URL */
const buildUrl = (
  cfg: StreamingServerConfig,
  endpoint: string,
  extra: Record<string, string | number> = {},
): string => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(authParams(cfg))) params.set(k, v);
  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return `${baseUrl(cfg)}/rest/${endpoint}?${params.toString()}`;
};

/** 解析 subsonic-response 包装；失败时抛错 */
const parseResponse = async <T = unknown>(res: Response): Promise<T> => {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const wrap = json?.["subsonic-response"];
  if (!wrap) throw new Error("响应缺少 subsonic-response 包装");
  if (wrap.status !== "ok") {
    throw new Error(wrap.error?.message || `Subsonic error code ${wrap.error?.code}`);
  }
  return wrap as T;
};

/** 带超时的 fetch */
const fetchWithTimeout = async (url: string, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * 连通性测试。成功返回服务器版本号。
 */
export const ping = async (cfg: StreamingServerConfig): Promise<StreamingPingResult> => {
  try {
    const res = await fetchWithTimeout(buildUrl(cfg, "ping"));
    const wrap = await parseResponse<{ version?: string; serverVersion?: string }>(res);
    return { ok: true, version: wrap.serverVersion ?? wrap.version };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`subsonic ping 失败 [${cfg.url}]:`, msg);
    return { ok: false, error: msg };
  }
};

/**
 * 构造歌曲流播放 URL（含鉴权参数）。
 * Subsonic 的 stream 接口支持 HTTP Range，audio-engine 的 FFmpeg backend 可直接消费。
 */
export const getStreamUrl = (cfg: StreamingServerConfig, originalId: string): string =>
  buildUrl(cfg, "stream", { id: originalId });

/**
 * 获取歌词（LRC 文本）。
 * 优先 OpenSubsonic 扩展接口 getLyricsBySongId（结构化），失败时回退 getLyrics（artist+title 字符串匹配）。
 * 任一拿不到都返回 null（不抛错），让上层走本地/embedded 兜底。
 */
export const getLyrics = async (
  cfg: StreamingServerConfig,
  originalId: string,
  hint?: { artist?: string; title?: string },
): Promise<string | null> => {
  // 优先试 getLyricsBySongId（OpenSubsonic）
  try {
    const res = await fetchWithTimeout(buildUrl(cfg, "getLyricsBySongId", { id: originalId }));
    const wrap = await parseResponse<{
      lyricsList?: { structuredLyrics?: { line?: { start?: number; value: string }[] }[] };
    }>(res);
    const structured = wrap.lyricsList?.structuredLyrics?.[0]?.line ?? [];
    if (structured.length > 0) {
      // 转 LRC：start 是毫秒
      return structured
        .map((l) => {
          const ms = Math.max(0, l.start ?? 0);
          const mm = Math.floor(ms / 60000);
          const ss = Math.floor((ms % 60000) / 1000);
          const xx = Math.floor((ms % 1000) / 10);
          const ts = `[${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(xx).padStart(2, "0")}]`;
          return `${ts}${l.value ?? ""}`;
        })
        .join("\n");
    }
  } catch (err) {
    log.debug("getLyricsBySongId 失败，尝试 getLyrics", err);
  }

  // 回退 getLyrics（旧 Subsonic）
  if (hint?.artist || hint?.title) {
    try {
      const res = await fetchWithTimeout(
        buildUrl(cfg, "getLyrics", {
          artist: hint.artist ?? "",
          title: hint.title ?? "",
        }),
      );
      const wrap = await parseResponse<{ lyrics?: { value?: string } }>(res);
      const text = wrap.lyrics?.value;
      if (text && text.trim()) return text;
    } catch (err) {
      log.debug("getLyrics 也失败", err);
    }
  }
  return null;
};
