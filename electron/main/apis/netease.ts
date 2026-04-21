/**
 * Netease API 主进程服务
 *
 * - 把 `@neteasecloudmusicapienhanced/api` 当 Node 库直接调（不起 HTTP server）
 * - 统一入口 `callNetease(name, params)`：查函数 → 注入 cookie → 调用
 */

import { createRequire } from "node:module";
import {
  getSessionCookies,
  saveSessionCookies,
  clearSessionCookies,
} from "@main/database/sessions";

/** 该包是纯 CJS 且 exports 通过 fs.readdirSync 动态填充，ESM 的 `import *`
 * 只能拿到静态检测的 named exports。用 createRequire 直接拿 module.exports。 */
const require = createRequire(import.meta.url);
const NeteaseApi = require("@neteasecloudmusicapienhanced/api") as Record<string, unknown>;

/** Netease API 函数签名 */
type NeteaseFn = (query: Record<string, unknown>) => Promise<{
  status: number;
  body: unknown;
  cookie?: string[];
}>;

/** 内存缓存：避免每次 callNetease 都走一次 SELECT */
let cache: Record<string, string> | null = null;

/**
 * 加载 cookies
 * @returns cookies
 */
const load = (): Record<string, string> => {
  if (!cache) cache = getSessionCookies("netease");
  return cache;
};

/**
 * 持久化 cookies
 * @param cookies cookies
 */
const persist = (cookies: Record<string, string>): void => {
  cache = cookies;
  saveSessionCookies("netease", cookies);
};

/**
 * 序列化 cookies
 * @param c cookies
 * @returns cookies string
 */
const serialize = (c: Record<string, string>): string =>
  Object.entries(c)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

/**
 * 读当前 cookies（调用方如需可用于派生登录态）
 * @returns cookies
 */
export const getNeteaseCookies = (): Record<string, string> => ({ ...load() });

/**
 * 整体替换 cookies（登出或重置场景）
 * @param cookies cookies
 */
export const setNeteaseCookies = (cookies: Record<string, string>): void => {
  persist(cookies);
};

/**
 * 增量合并 cookies（登录成功拿到 MUSIC_U 时用）
 * @param patch cookies
 */
export const mergeNeteaseCookies = (patch: Record<string, string>): void => {
  persist({ ...load(), ...patch });
};

/** 清空 cookies */
export const clearNeteaseCookies = (): void => {
  cache = {};
  clearSessionCookies("netease");
};

/**
 * 调用任意Netease API
 * @param name interface.d.ts 中声明的方法名（如 `search` / `song_url_v1` / `lyric`）
 * @param params 接口参数；无需传 cookie，服务会自动注入
 */
export const callNetease = async (
  name: string,
  params: Record<string, unknown> = {},
): Promise<{ status: number; body: unknown }> => {
  const fn = NeteaseApi[name];
  if (typeof fn !== "function") {
    throw new Error(`unknown netease api: ${name}`);
  }
  const cookieStr = serialize(load());
  const res = await (fn as NeteaseFn)({
    ...params,
    cookie: cookieStr || undefined,
  });
  return { status: res.status, body: res.body };
};
