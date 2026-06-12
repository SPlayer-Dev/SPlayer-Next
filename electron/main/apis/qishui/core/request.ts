/**
 * QS 请求层
 *
 * GET api.qishui.com/luna/pc/*，明文 JSON。带有界重试吸收偶发瞬时错误。
 */

import { QS_HEADERS, QS_WEB_PARAMS } from "./config";

/** 偶发瞬时失败重试次数与退避 */
const MAX_RETRY = 2;
const RETRY_BACKOFF = 300;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 发起一次 QS web GET
 * @param baseUrl - 端点
 * @param params - 业务参数（会并入 web 公共参数）
 * @returns 解析后的 JSON 业务体
 */
export const qsRequest = async <T = unknown>(
  baseUrl: string,
  params: Record<string, string>,
): Promise<T> => {
  const query = new URLSearchParams({ ...QS_WEB_PARAMS, ...params }).toString();
  const url = `${baseUrl}?${query}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: QS_HEADERS,
        signal: AbortSignal.timeout(10000),
      });
      if (res.status !== 200) throw new Error(`QS HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRY) await delay(RETRY_BACKOFF);
    }
  }
  throw lastErr;
};
