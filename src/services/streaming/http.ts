/**
 * 渲染层 fetch 工具：统一超时、错误抽取、auth 错误识别
 */
import { StreamingAuthError, StreamingHttpError, StreamingTimeoutError } from "./errors";

const REQUEST_TIMEOUT = 15_000;

/**
 * 带超时的 fetch；超时抛 StreamingTimeoutError
 * @param url - 目标 URL
 * @param init - fetch 选项
 * @param timeout - 超时毫秒数（默认 15s）
 */
export const fetchWithTimeout = async (
  url: string,
  init?: RequestInit,
  timeout = REQUEST_TIMEOUT,
): Promise<Response> => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new StreamingTimeoutError(`请求超时 (${timeout}ms)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * 校验响应
 * 401/403 抛 StreamingAuthError，其它非 2xx 抛 StreamingHttpError
 * @param res - fetch 响应
 */
export const ensureOk = (res: Response): void => {
  if (res.ok) return;
  if (res.status === 401 || res.status === 403) {
    throw new StreamingAuthError(`HTTP ${res.status}`);
  }
  throw new StreamingHttpError(res.status);
};

/**
 * 标准化 baseUrl，去掉尾斜杠
 * @param url - 服务器地址
 */
export const normalizeBase = (url: string): string => url.replace(/\/+$/, "");
