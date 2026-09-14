/**
 * QM 请求层
 *
 * 设计：
 * - 统一走 u.y.qq.com/cgi-bin/musicu.fcg 的 `{ comm, request: {module, method, param} }` 协议
 * - 首次请求前先调 music.getSession.session 拿 uid/sid/userip，缓存 1 小时
 * - 没有加密：API 本身明文 JSON POST，靠 UA + QIMEI36 等 comm 字段伪装客户端
 * - Referer 设为 https://y.qq.com，部分接口会校验
 */

import { QM_API_URL, QM_HEADERS, SESSION_TTL, getCommonParams } from "./config";
import {
  clearSessionCookies,
  getSessionCookies,
  saveSessionCookies,
} from "@main/database/sessions";
import { coreLog } from "@main/utils/logger";
import { sessionToCookieHeader } from "./credential";

/** Session 字段（可能缺失则下次请求会自动补拿） */
interface SessionCache {
  uid?: string;
  sid?: string;
  userip?: string;
  expireAt: number;
}

let session: SessionCache = { expireAt: 0 };
let initPromise: Promise<void> | null = null;
let userCookies: Record<string, string> | null = null;
let sessionGeneration = 0;

/** 使当前客户端会话失效，避免账号变化后继续复用旧会话 */
const invalidateSession = (): void => {
  sessionGeneration++;
  session = { expireAt: 0 };
};

/** 读取内存或数据库中的 QM cookies */
export const getQQMusicCookies = (): Record<string, string> => {
  if (userCookies !== null) return userCookies;
  userCookies = getSessionCookies("qqmusic");
  return userCookies;
};

/** 更新 QM cookies 并落库 */
export const mergeQQMusicCookies = (cookies: Record<string, string>): void => {
  const current = getQQMusicCookies();
  userCookies = { ...current, ...cookies };
  saveSessionCookies("qqmusic", userCookies);
  invalidateSession();
  coreLog.info(`[qm-cookie] 已保存 Cookie (${Object.keys(userCookies).length} 个字段)`);
};

/** 清空 QM cookies 登录态 */
export const clearQQMusicCookies = (): void => {
  userCookies = {};
  clearSessionCookies("qqmusic");
  invalidateSession();
  coreLog.info("[qm-cookie] 已从数据库中清空 QM Session");
};

/** 提取当前登录 uin（纯数字形式） */
export const getQQMusicUin = (): string => {
  const cookies = getQQMusicCookies();
  const raw = cookies.qm_str_musicid || cookies.uin || cookies.wxuin || cookies.p_uin || "";
  return raw ? raw.replace(/^o/, "") : "0";
};

/** 重试次数与退避 */
const MAX_RETRY = 2;
const RETRY_BACKOFF = 300;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface FcgResponse {
  code?: number;
  request?: { code?: number; data?: unknown };
  [key: string]: unknown;
}

export interface QMRequestOptions {
  /** 是否在请求前初始化客户端会话 */
  session?: boolean;
  /** 追加到 comm 的字段（如 tmeLoginType） */
  comm?: Record<string, unknown>;
  /** 是否需要携带用户认证凭据 */
  auth?: boolean;
  /** 是否允许在收到鉴权错误时自动刷新凭据 */
  autoRefresh?: boolean;
}

/** 发起一次 fcg POST */
const postRaw = async (
  body: unknown,
  extraHeaders?: Record<string, string>,
  useAuth = true,
): Promise<FcgResponse> => {
  const cookies = useAuth ? getQQMusicCookies() : {};
  const cookieStr = sessionToCookieHeader(cookies);

  const res = await fetch(QM_API_URL, {
    method: "POST",
    headers: {
      ...QM_HEADERS,
      ...(cookieStr ? { Cookie: cookieStr } : { Cookie: "tmeLoginType=-1;" }),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  return (await res.json()) as FcgResponse;
};

/** 初始化 / 刷新 session（1h 过期）；并发安全：同一时刻只发一次 */
const ensureSession = (): Promise<void> => {
  if (session.uid && session.expireAt > Date.now()) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const generation = sessionGeneration;
    try {
      const uin = getQQMusicUin();
      const body = {
        comm: {
          ...getCommonParams(),
          ...(uin && uin !== "0" ? { uin } : {}),
        },
        request: {
          module: "music.getSession.session",
          method: "GetSession",
          param: { caller: 0, uid: uin, vkey: 0 },
        },
      };
      const data = await postRaw(body);
      if (generation === sessionGeneration && data.code === 0 && data.request?.code === 0) {
        const info =
          ((data.request.data as { session?: Partial<SessionCache> }) ?? {}).session ?? {};
        session = {
          uid: info.uid,
          sid: info.sid,
          userip: info.userip,
          expireAt: Date.now() + SESSION_TTL,
        };
      }
    } catch {
      // session 失败不阻塞后续调用，大部分接口无 session 也能回结果
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
};

/**
 * 发送一次 musicu.fcg 请求
 * @param module 业务 module（如 music.search.SearchCgiService）
 * @param method 业务 method（如 DoSearchForQQMusicMobile）
 * @param param  业务 param
 * @param options 请求选项
 * @returns request.data 的业务数据段
 */
export const qmRequest = async <T = unknown>(
  module: string,
  method: string,
  param: Record<string, unknown>,
  options: QMRequestOptions = {},
): Promise<T> => {
  const useSession = options.session !== false;
  if (useSession) await ensureSession();

  const useAuth = options.auth !== false;
  let triedRefresh = false;

  const buildComm = () => {
    const cookies = getQQMusicCookies();
    const musickey = useAuth ? cookies.qm_keyst || cookies.qqmusic_key : undefined;
    const uin = useAuth ? getQQMusicUin() : undefined;
    const loginType =
      cookies.tmeLoginType !== undefined
        ? Number(cookies.tmeLoginType)
        : musickey?.startsWith("W_X")
          ? 1
          : 2;

    return {
      ...getCommonParams(),
      ...(uin && uin !== "0" ? { uin, qq: uin } : {}),
      ...(musickey ? { authst: musickey, tmeLoginType: loginType } : {}),
      ...(useSession && session.uid ? { uid: session.uid } : {}),
      ...(useSession && session.sid ? { sid: session.sid } : {}),
      ...(useSession && session.userip ? { userip: session.userip } : {}),
      ...(options.comm ?? {}),
    };
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const comm = buildComm();
      const body = { comm, request: { module, method, param } };
      const data = await postRaw(body, undefined, useAuth);
      const outerCode = data.code ?? 0;
      const innerCode = data.request?.code ?? 0;

      // 遇到鉴权失败或系统拦截错误（1000: 未登录/token失效, 2001: 会话异常）
      const isAuthError =
        useAuth &&
        getQQMusicUin() !== "0" &&
        outerCode === 0 &&
        (innerCode === 1000 || innerCode === 2001);
      if (isAuthError && options.autoRefresh !== false && !triedRefresh) {
        triedRefresh = true;
        coreLog.warn(
          `[qm-request] 接口遇到鉴权异常 (outer=${outerCode} inner=${innerCode})，尝试自动刷新凭据...`,
        );
        invalidateSession();

        const refreshed = await refreshQMCredential();
        if (refreshed) {
          coreLog.info("[qm-request] 凭据刷新成功，重试当前请求");
          attempt = -1;
          continue;
        }
      }

      if (outerCode !== 0 || innerCode !== 0) {
        throw new Error(`QM API 错误: outer=${outerCode} inner=${innerCode}`);
      }
      return data.request?.data as T;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRY) await delay(RETRY_BACKOFF);
    }
  }
  throw lastErr;
};

/** 调试用：取当前 session 快照 */
export const getQMSession = (): Readonly<SessionCache> => session;

/** LoginServer.Login 刷新后的凭据字段 */
interface RefreshCredentialData {
  musickey?: string;
  openid?: string;
  unionid?: string;
  refresh_token?: string;
  access_token?: string;
  expired_at?: number;
  musicid?: number;
  str_musicid?: string;
  refresh_key?: string;
  musickeyCreateTime?: number;
  encryptUin?: string;
  loginType?: number;
}

/**
 * 执行 LoginServer.Login（loginMode=2）向服务端请求刷新 musickey
 */
const performRefreshCredential = async (): Promise<boolean> => {
  const cookies = getQQMusicCookies();
  const uin = getQQMusicUin();
  const musickey = cookies.qm_keyst || cookies.qqmusic_key;
  if (!uin || uin === "0" || !musickey) return false;

  const loginType = Number(cookies.tmeLoginType) || (musickey.startsWith("W_X") ? 1 : 2);
  const refreshKey = cookies.qm_refresh_key || "";

  let param: Record<string, unknown>;
  if (loginType === 1) {
    // 微信型凭据刷新
    param = {
      openid: cookies.wxopenid || cookies.psrf_qqopenid || "",
      refresh_token: cookies.wxrefresh_token || cookies.psrf_qqrefresh_token || "",
      str_musicid: cookies.qm_str_musicid || uin,
      musickey,
      unionid: cookies.psrf_qqunionid || "",
      refresh_key: refreshKey,
      loginMode: 2,
    };
  } else {
    // QQ 型凭据刷新
    param = {
      openid: cookies.psrf_qqopenid || cookies.wxopenid || "",
      access_token: cookies.psrf_qqaccess_token || "",
      refresh_token: cookies.psrf_qqrefresh_token || cookies.wxrefresh_token || "",
      expired_in: Number(cookies.psrf_access_token_expiresAt) || 0,
      musicid: Number(uin) || 0,
      musickey,
      refresh_key: refreshKey,
      loginMode: 2,
    };
  }

  try {
    // 直连而不走 qmRequest：避免业务码非零时的无意义重试，且能拿到完整拒绝原因
    const resp = await postRaw({
      comm: {
        ...getCommonParams(),
        ...(uin !== "0" ? { uin, qq: uin } : {}),
        authst: musickey,
        tmeLoginType: loginType,
      },
      request: {
        module: "music.login.LoginServer",
        method: "Login",
        param,
      },
    });
    const inner = resp.request;
    if (resp.code !== 0 || inner?.code !== 0) {
      coreLog.warn("[qm-refresh] 刷新被拒绝:", JSON.stringify(inner ?? resp));
      return false;
    }
    const data = inner?.data as RefreshCredentialData | undefined;
    if (!data?.musickey) return false;

    const refreshed: Record<string, string> = {
      qm_keyst: data.musickey,
      qqmusic_key: data.musickey,
      tmeLoginType: String(data.loginType ?? loginType),
    };
    if (data.str_musicid || data.musicid) {
      const musicId = String(data.str_musicid || data.musicid).replace(/^o/, "");
      refreshed.qm_str_musicid = musicId;
      refreshed.uin = musicId;
      if (loginType === 1) refreshed.wxuin = musicId;
    }
    if (data.encryptUin) refreshed.euin = data.encryptUin;
    if (data.openid) refreshed[loginType === 1 ? "wxopenid" : "psrf_qqopenid"] = data.openid;
    if (data.unionid) refreshed.psrf_qqunionid = data.unionid;
    if (data.refresh_token)
      refreshed[loginType === 1 ? "wxrefresh_token" : "psrf_qqrefresh_token"] = data.refresh_token;
    if (data.access_token) refreshed.psrf_qqaccess_token = data.access_token;
    if (data.expired_at) refreshed.psrf_access_token_expiresAt = String(data.expired_at);
    if (data.musickeyCreateTime)
      refreshed.psrf_musickey_createtime = String(data.musickeyCreateTime);
    // 网页 cookie 无此字段，首次刷新后落库供后续刷新复用
    if (data.refresh_key) refreshed.qm_refresh_key = data.refresh_key;

    mergeQQMusicCookies(refreshed);
    coreLog.info("[qm-refresh] musickey 刷新成功", { uin });
    return true;
  } catch (err) {
    coreLog.warn("[qm-refresh] musickey 刷新失败:", err);
    return false;
  }
};

let refreshPromise: Promise<boolean> | null = null;

/**
 * 刷新 QM 凭据（内置并发安全互斥锁）
 * 多个并发请求触发时只发起一次实际的刷新请求
 * @returns 刷新成功（新 key 已写回 cookie）返回 true；失败返回 false
 */
export const refreshQMCredential = async (): Promise<boolean> => {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      return await performRefreshCredential();
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
};
