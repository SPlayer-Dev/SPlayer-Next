/**
 * 渲染层 fetch 工具：统一超时、错误抽取、auth 错误识别
 */
import { StreamingAuthError, StreamingHttpError } from "./errors";

const REQUEST_TIMEOUT = 15_000;

/** 带超时的 fetch */
export const fetchWithTimeout = async (
  url: string,
  init?: RequestInit,
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

/** 401 抛 StreamingAuthError，其它非 2xx 抛 StreamingHttpError */
export const ensureOk = (res: Response): void => {
  if (res.ok) return;
  if (res.status === 401 || res.status === 403) {
    throw new StreamingAuthError(`HTTP ${res.status}`);
  }
  throw new StreamingHttpError(res.status);
};

/** 标准化 baseUrl，去掉尾斜杠 */
export const normalizeBase = (url: string): string => url.replace(/\/+$/, "");
