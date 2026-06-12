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

/** Session 字段（可能缺失则下次请求会自动补拿） */
interface SessionCache {
  uid?: string;
  sid?: string;
  userip?: string;
  expireAt: number;
}

let session: SessionCache = { expireAt: 0 };
let initPromise: Promise<void> | null = null;

/** 重试次数与退避 */
const MAX_RETRY = 2;
const RETRY_BACKOFF = 300;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface FcgResponse {
  code?: number;
  request?: { code?: number; data?: unknown };
  [key: string]: unknown;
}

/** 直接发起一次 fcg POST（不做 session 注入，用于初始化自身） */
const postRaw = async (body: unknown): Promise<FcgResponse> => {
  const res = await fetch(QM_API_URL, {
    method: "POST",
    headers: QM_HEADERS,
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
    try {
      const body = {
        comm: getCommonParams(),
        request: {
          module: "music.getSession.session",
          method: "GetSession",
          param: { caller: 0, uid: "0", vkey: 0 },
        },
      };
      const data = await postRaw(body);
      if (data.code === 0 && data.request?.code === 0) {
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
 * @returns request.data 的业务数据段
 */
export const qmRequest = async <T = unknown>(
  module: string,
  method: string,
  param: Record<string, unknown>,
): Promise<T> => {
  await ensureSession();

  const comm = {
    ...getCommonParams(),
    ...(session.uid ? { uid: session.uid } : {}),
    ...(session.sid ? { sid: session.sid } : {}),
    ...(session.userip ? { userip: session.userip } : {}),
  };

  const body = { comm, request: { module, method, param } };

  // QM 后端偶发瞬时错误
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const data = await postRaw(body);
      const outerCode = data.code ?? 0;
      const innerCode = data.request?.code ?? 0;
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
