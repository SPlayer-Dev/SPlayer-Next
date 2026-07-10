/**
 * Netease API 主进程服务
 *
 * 直接在 Node 侧实现加解密 + HTTP 调用，不依赖任何网易云服务端 npm 包。
 * 加密算法等核心逻辑见 core/crypto.ts。
 *
 * 统一入口 `callNetease(name, params)`：
 *   1) 从 sessions 表加载 cookies 注入（内存缓存，不重复读 SQLite）
 *   2) 走一层内存响应缓存（2 分钟）
 *   3) 路由到 modules/<name>
 *   4) 只在登录相关接口上把响应 set-cookie 写回 sessions；其它接口不落库
 */

import {
  clearSessionCookies,
  getSessionCookies,
  saveSessionCookies,
} from "@main/database/sessions";
import { store } from "@main/store";
import { buildCacheKey, cacheClear, cacheGet, cacheSet } from "./core/cache";
import { cookieToJson } from "./core/cookie";
import { createRequest } from "./core/request";
import { modules } from "./modules";
import type { Query } from "./core/option";

/** 会变更登录态的接口：响应里若带 set-cookie，才值得写回 SQLite */
const SESSION_MUTATING: ReadonlySet<string> = new Set([
  "login",
  "login_cellphone",
  "login_qr_check",
  "login_refresh",
  "logout",
  "register_anonimous",
]);

/** 不采用缓存的实时接口 */
const NON_CACHEABLE: ReadonlySet<string> = new Set([
  "song_url",
  "song_download_url",
  "scrobble",
  "scrobble_v1",
  "like",
  "playlist_create",
  "playlist_delete",
  "playlist_tracks",
  "playlist_subscribe",
  "playlist_name_update",
  "playlist_desc_update",
  "playlist_order_update",
  "playlist_detail",
  "user_playlist",
  "user_subcount",
  "user_cloud",
  "user_cloud_del",
  "cloud_upload_check",
  "cloud_nos_token",
  "cloud_upload_info",
  "cloud_pub",
  "cloud_upload_check_v2",
  "cloud_song_import",
  "album_sub",
  "playmode_intelligence",
  "personal_fm",
  "fm_trash",
  "recommend_songs",
  "artist_new_song_playall",
  "artist_new_song_mv_list_v2",
]);

/** 国内 IP 前缀池 */
const CN_IP_PREFIXES = [
  "116.25",
  "121.8",
  "120.36",
  "39.144",
  "117.136",
  "223.104",
  "171.8",
  "182.140",
];

/** 本会话的国内 IP */
let cachedRealIp = "";
const sessionRealIp = (): string => {
  if (!cachedRealIp) {
    const prefix = CN_IP_PREFIXES[Math.floor(Math.random() * CN_IP_PREFIXES.length)];
    const third = Math.floor(Math.random() * 256);
    const fourth = 1 + Math.floor(Math.random() * 254);
    cachedRealIp = `${prefix}.${third}.${fourth}`;
  }
  return cachedRealIp;
};

/** 内存缓存 */
let sessionCache: Record<string, string> | null = null;

const loadSession = (): Record<string, string> => {
  if (!sessionCache) sessionCache = getSessionCookies("netease");
  return sessionCache;
};

const persistSession = (cookies: Record<string, string>): void => {
  sessionCache = cookies;
  saveSessionCookies("netease", cookies);
};

/** "k1=v1; k2=v2; ..." 形式序列化 */
const serialize = (cookies: Record<string, string>): string =>
  Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

export const getNeteaseCookies = (): Record<string, string> => ({ ...loadSession() });

export const setNeteaseCookies = (cookies: Record<string, string>): void => {
  persistSession(cookies);
  cacheClear();
};

export const mergeNeteaseCookies = (patch: Record<string, string>): void => {
  persistSession({ ...loadSession(), ...patch });
  cacheClear();
};

export const clearNeteaseCookies = (): void => {
  sessionCache = {};
  clearSessionCookies("netease");
  cacheClear();
};

/** set-cookie 数组 → 扁平对象（只取 key=value，忽略 Path/Domain/Max-Age 等属性） */
const parseSetCookie = (arr: string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const raw of arr) {
    const first = raw.split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const key = first.slice(0, eq).trim();
    const val = first.slice(eq + 1).trim();
    if (key) out[key] = val;
  }
  return out;
};

/**
 * 调用任意 Netease API
 * @param name 见 modules/index.ts 中的 key
 * @param params 业务参数；cookie 自动注入，无需调用方传
 */
export const callNetease = async (
  name: string,
  params: Record<string, unknown> = {},
): Promise<{ status: number; body: any }> => {
  // hasOwn 守卫
  const fn = Object.hasOwn(modules, name) ? modules[name] : undefined;
  if (!fn) throw new Error(`unknown netease api: ${name}`);

  const session = loadSession();

  // 读缓存
  const cacheable = !NON_CACHEABLE.has(name);
  const cacheKey = cacheable ? buildCacheKey(name, params) : "";
  if (cacheable) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
  }

  const query: Query = {
    ...params,
    cookie:
      typeof params.cookie === "string"
        ? cookieToJson(params.cookie)
        : (params.cookie as Record<string, string> | undefined) || { ...session },
  };

  // 注入国内 IP
  if (store.get("system.neteaseRealIp") && query.realIP === undefined) {
    query.realIP = sessionRealIp();
  }

  const res = await fn(query, createRequest);

  // 仅登录态变更接口才把响应 cookie 写回 SQLite
  if (SESSION_MUTATING.has(name) && res.cookie?.length) {
    const patch = parseSetCookie(res.cookie);
    if (Object.keys(patch).length) {
      persistSession({ ...loadSession(), ...patch });
      cacheClear();
    }
  }

  const value = { status: res.status, body: res.body };
  if (cacheable && res.status === 200) cacheSet(cacheKey, value);

  return value;
};

/** 调试用：当前 cookie 序列化字符串 */
export const currentCookieString = (): string => serialize(loadSession());
