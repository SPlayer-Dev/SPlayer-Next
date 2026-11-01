/** 注入平台会话、路由业务接口并管理有界响应缓存 */

import {
  clearSessionCookies,
  getSessionCookies,
  saveSessionCookies,
} from "@main/database/sessions";
import { store } from "@main/store";
import { buildCacheKey, cacheClear, cacheGet, cacheSet } from "./core/cache";
import { cookieToJson } from "./core/cookie";
import { getAnonymousToken, getDeviceId, setAnonymousToken, setDeviceId } from "./core/device";
import { createRequest } from "./core/request";
import { resetXeapiKey } from "./core/xeapi";
import { resetWebClientSession } from "./core/webClient";
import { modules } from "./modules";
import { neteaseLog } from "@main/utils/logger";
import { createOption, type Query } from "./core/option";
import { DOMAIN } from "./core/config";

/** 会更新登录凭据或网页 SDK 状态的接口 */
const SESSION_MUTATING: ReadonlySet<string> = new Set([
  "login",
  "login_cellphone",
  "login_qr_check",
  "login_refresh",
  "logout",
  "register_anonimous",
  "scrobble",
  "song_like",
  "artist_sub",
  "album_sub",
  "playlist_subscribe",
  "playlist_tracks",
]);

/** 不采用缓存的实时接口 */
const NON_CACHEABLE: ReadonlySet<string> = new Set([
  "audio_match",
  "captcha_sent",
  "captcha_verify",
  "login",
  "login_cellphone",
  "login_qr_check",
  "login_qr_create",
  "login_qr_key",
  "login_refresh",
  "login_status",
  "logout",
  "register_anonimous",
  "deviceinfo_center_upload",
  "song_url",
  "song_download_url",
  "scrobble",
  "scrobble_v1",
  "like",
  "like_v1",
  "song_like",
  "likelist",
  "album_sublist",
  "artist_sublist",
  "user_level",
  "user_record",
  "record_recent_song",
  "artist_sub",
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
]);

/** 无需初始化平台匿名登录态的公开接口 */
const SESSIONLESS: ReadonlySet<string> = new Set(["audio_match"]);

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
let sessionVersion = 0;
let anonymousSessionPromise: Promise<void> | null = null;

const syncDeviceState = (session: Record<string, string>): void => {
  if (session.deviceId) setDeviceId(session.deviceId);
  setAnonymousToken(session.MUSIC_A || "");
};

const loadSession = (): Record<string, string> => {
  if (!sessionCache) {
    sessionCache = getSessionCookies("netease");
    syncDeviceState(sessionCache);
  }
  return sessionCache;
};

const persistSession = (cookies: Record<string, string>): void => {
  if (loadSession().MUSIC_U !== cookies.MUSIC_U) resetWebClientSession();
  sessionVersion++;
  sessionCache = cookies;
  syncDeviceState(cookies);
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
  resetWebClientSession();
  sessionVersion++;
  sessionCache = {};
  setAnonymousToken("");
  resetXeapiKey();
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

/** 确保未登录时已有稳定的 MUSIC_A 与 deviceId */
export const ensureNeteaseAnonymousSession = async (): Promise<void> => {
  const sessionState = loadSession();
  if (sessionState.MUSIC_U || sessionState.MUSIC_A || getAnonymousToken()) return;
  if (anonymousSessionPromise) return anonymousSessionPromise;

  anonymousSessionPromise = (async () => {
    const session = loadSession();
    const result = await modules.register_anonimous({ cookie: { ...session } }, createRequest);
    const body = result.body as { token?: unknown };
    const patch = parseSetCookie(result.cookie ?? []);
    const token = typeof body.token === "string" ? body.token : patch.MUSIC_A;
    if (!token) throw new Error("netease anonymous registration missing MUSIC_A");
    persistSession({
      ...loadSession(),
      ...patch,
      MUSIC_A: token,
      deviceId: getDeviceId(),
    });
    cacheClear();
    neteaseLog.info("游客会话初始化成功");
  })().finally(() => {
    anonymousSessionPromise = null;
  });

  return anonymousSessionPromise;
};

/**
 * 调用注册模块或原始业务路径，复用宿主会话与加密层
 * @param name - 接口模块名或 /api/ 业务路径
 * @param params - 业务参数，登录状态由宿主注入
 * @returns 原始响应状态与业务正文
 */
export const callNetease = async (
  name: string,
  params: Record<string, unknown> = {},
): Promise<{ status: number; body: any }> => {
  // 原始业务路径复用同一登录态与加密层，不接受完整 URL 或路径跳转
  const rawPath = /^\/api\/[a-zA-Z0-9_/-]+$/.test(name);
  const fn = Object.hasOwn(modules, name)
    ? modules[name]
    : rawPath
      ? (query: Query) => {
          const {
            cookie: _cookie,
            crypto: _crypto,
            client: _client,
            ua: _ua,
            realIP: _realIP,
            ip: _ip,
            domain: _domain,
            checkToken: _checkToken,
            e_r: _e_r,
            ...data
          } = query;
          const options = createOption(query, "api");
          if (options.crypto === "api") options.domain = DOMAIN;
          return createRequest(name, data, options);
        }
      : undefined;
  if (!fn) throw new Error(`unknown netease api: ${name}`);

  const isSessionEndpoint =
    name.startsWith("login") ||
    name.startsWith("captcha") ||
    name === "logout" ||
    name === "register_anonimous";
  if (!isSessionEndpoint && !SESSIONLESS.has(name) && params.cookie === undefined) {
    await ensureNeteaseAnonymousSession();
  }
  const session = loadSession();

  const cacheable = !rawPath && !NON_CACHEABLE.has(name);
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

  if (store.get("system.neteaseRealIp") && query.realIP === undefined) {
    query.realIP = sessionRealIp();
  }

  const requestSessionVersion = sessionVersion;
  const res = await fn(query, createRequest);
  /** 旧会话的响应不能覆盖登出或切换账号后的凭据与缓存 */
  if (requestSessionVersion !== sessionVersion) {
    return { status: res.status, body: res.body };
  }

  /** 保留登录续期和网页 SDK 产生的会话状态 */
  if (SESSION_MUTATING.has(name)) {
    const patch = parseSetCookie(res.cookie ?? []);
    if (name === "register_anonimous") {
      const token = (res.body as { token?: unknown }).token;
      if (typeof token === "string") patch.MUSIC_A = token;
      patch.deviceId = getDeviceId();
    }
    if (Object.keys(patch).length) {
      persistSession({ ...loadSession(), ...patch });
      cacheClear();
    }
  }

  const value = { status: res.status, body: res.body };
  if (cacheable && res.status === 200 && Number((res.body as { code?: unknown }).code) === 200) {
    cacheSet(cacheKey, value);
  }

  return value;
};

/** 调试用：当前 cookie 序列化字符串 */
export const currentCookieString = (): string => serialize(loadSession());
