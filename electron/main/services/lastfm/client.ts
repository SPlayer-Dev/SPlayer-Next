import { createHash } from "node:crypto";

/**
 * Last.fm 底层签名 HTTP 客户端
 * API 文档: https://www.last.fm/api
 */

const API_URL = "https://ws.audioscrobbler.com/2.0/";

// 应用级凭证
const LASTFM_API_KEY = "79fa364d995b13c2b21bdd65b7e7054f";
const LASTFM_API_SECRET = "6d2ecc338d0a0802669e529f14b8034f";

/** Last.fm JSON 响应中我们关心的字段 */
interface LastfmResponse {
  error?: number;
  message?: string;
  token?: string;
  session?: { name: string; key: string };
}

/**
 * 生成浏览器授权地址
 * @param token - auth.getToken 拿到的临时令牌
 * @returns 授权页 URL
 */
export const getAuthUrl = (token: string): string =>
  `https://www.last.fm/api/auth/?api_key=${LASTFM_API_KEY}&token=${token}`;

/**
 * 生成 api_sig：除 format 外按字母序拼 key+value，末尾接 secret 后取 md5
 * 注意：MD5 是 Last.fm 签名协议的强制要求（服务端同样以 md5 校验），并非用于
 * 加密/防篡改的安全用途，无法替换为更强算法，否则所有请求会被 Last.fm 拒绝。
 * @param params - 待签名参数（不含 api_sig / format）
 * @returns 32 位十六进制签名
 */
const sign = (params: Record<string, string>): string => {
  const base = Object.keys(params)
    .filter((key) => key !== "format")
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");
  return createHash("md5")
    .update(base + LASTFM_API_SECRET, "utf-8")
    .digest("hex");
};

/**
 * 组装请求参数：补 method/api_key，按需签名，最后补 format
 * @param method - API 方法名
 * @param params - 业务参数
 * @param signed - 是否需要签名
 * @returns URLSearchParams
 */
const buildParams = (
  method: string,
  params: Record<string, string>,
  signed: boolean,
): URLSearchParams => {
  const base: Record<string, string> = { method, api_key: LASTFM_API_KEY, ...params };
  if (signed) base.api_sig = sign(base);
  base.format = "json";
  return new URLSearchParams(base);
};

/** GET 请求（读操作） */
const get = async (
  method: string,
  params: Record<string, string> = {},
  signed = false,
): Promise<LastfmResponse> => {
  const qs = buildParams(method, params, signed);
  const res = await fetch(`${API_URL}?${qs.toString()}`);
  const data = (await res.json()) as LastfmResponse;
  if (data.error) throw new Error(`Last.fm ${data.error}: ${data.message ?? "未知错误"}`);
  return data;
};

/** POST 请求（写操作，必签名） */
const post = async (
  method: string,
  params: Record<string, string> = {},
): Promise<LastfmResponse> => {
  const body = buildParams(method, params, true);
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json()) as LastfmResponse;
  if (data.error) throw new Error(`Last.fm ${data.error}: ${data.message ?? "未知错误"}`);
  return data;
};

/** 已授权会话 */
export interface LastfmSession {
  /** 用户名 */
  name: string;
  /** 会话密钥（不过期） */
  key: string;
}

/**
 * 获取临时授权令牌
 * @returns token 字符串
 */
export const getToken = async (): Promise<string> => {
  const data = await get("auth.getToken", {}, true);
  if (!data.token) throw new Error("无法获取 Last.fm token");
  return data.token;
};

/**
 * 用授权令牌换取会话（用户在浏览器授权后才会成功）
 * @param token - getToken 拿到的令牌
 * @returns 会话信息
 */
export const getSession = async (token: string): Promise<LastfmSession> => {
  const data = await get("auth.getSession", { token }, true);
  if (!data.session?.key) throw new Error("尚未授权");
  return { name: data.session.name, key: data.session.key };
};

/**
 * 上报「正在播放」
 * @param sessionKey - 会话密钥
 * @param track - 歌曲名
 * @param artist - 主艺人名
 * @param album - 专辑名
 * @param durationSec - 时长（秒）
 */
export const updateNowPlaying = async (
  sessionKey: string,
  track: string,
  artist: string,
  album?: string,
  durationSec?: number,
): Promise<void> => {
  const params: Record<string, string> = { sk: sessionKey, track, artist };
  if (album) params.album = album;
  if (durationSec) params.duration = String(durationSec);
  await post("track.updateNowPlaying", params);
};

/**
 * 记录播放（scrobble）
 * @param sessionKey - 会话密钥
 * @param track - 歌曲名
 * @param artist - 主艺人名
 * @param timestamp - 开始播放的 Unix 时间戳（秒）
 * @param album - 专辑名
 * @param durationSec - 时长（秒）
 */
export const scrobble = async (
  sessionKey: string,
  track: string,
  artist: string,
  timestamp: number,
  album?: string,
  durationSec?: number,
): Promise<void> => {
  const params: Record<string, string> = {
    sk: sessionKey,
    track,
    artist,
    timestamp: String(timestamp),
  };
  if (album) params.album = album;
  if (durationSec) params.duration = String(durationSec);
  await post("track.scrobble", params);
};

/**
 * 喜欢 / 取消喜欢
 * @param sessionKey - 会话密钥
 * @param track - 歌曲名
 * @param artist - 主艺人名
 * @param loved - true 为 Love，false 为 Unlove
 */
export const love = async (
  sessionKey: string,
  track: string,
  artist: string,
  loved: boolean,
): Promise<void> => {
  await post(loved ? "track.love" : "track.unlove", { sk: sessionKey, track, artist });
};
