/**
 * Netease API 主进程服务
 *
 * 直接在 Node 侧实现加解密 + HTTP 调用，不再依赖任何网易云服务端 npm 包。
 * 加密算法等核心逻辑移植自 @neteasecloudmusicapienhanced/api（见 core/crypto.ts）。
 *
 * 统一入口 `callNetease(name, params)`：
 *   1) 从 sessions 表加载 cookies 注入（内存缓存，不重复读 SQLite）
 *   2) 走一层内存响应缓存（2 分钟，对齐原包 apicache 行为）
 *   3) 路由到 modules/<name>
 *   4) 只在登录相关接口上把响应 set-cookie 写回 sessions；其它接口不落库
 */

import {
  clearSessionCookies,
  getSessionCookies,
  saveSessionCookies,
} from "@main/database/sessions";
import { buildCacheKey, cacheClear, cacheGet, cacheSet } from "./core/cache";
import { cookieToJson } from "./core/cookie";
import { createRequest } from "./core/request";
import { modules } from "./modules";

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
  "album_sub",
]);

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
  const fn = modules[name];
  if (!fn) throw new Error(`unknown netease api: ${name}`);

  const session = loadSession();

  // 读缓存
  const cacheable = !NON_CACHEABLE.has(name);
  const cacheKey = cacheable ? buildCacheKey(name, params) : "";
  if (cacheable) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
  }

  const query = {
    ...params,
    cookie:
      typeof params.cookie === "string"
        ? cookieToJson(params.cookie)
        : (params.cookie as Record<string, string> | undefined) || { ...session },
  };

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
