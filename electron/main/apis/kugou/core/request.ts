/**
 * KG 请求层
 *
 * 设计：
 * - 搜索走 songsearch.kugou.com（JSON，无鉴权），透传查询参数
 * - 歌词走 lyrics.kugou.com（JSON，需要 KG-RC/KG-THash/UA 伪装 PC 客户端）
 * - 出错自动重试，最多 3 次；非 200 或 error_code != 0 视为失败
 * - 没有加密 body，纯 fetch GET
 */

interface FetchOptions {
  headers?: Record<string, string>;
  /** 最大重试次数（不含首次），默认 2 → 总共最多 3 次 */
  retry?: number;
}

interface KGRawBody {
  status?: number;
  error_code?: number;
  errcode?: number;
  err_code?: number;
  data?: unknown;
  info?: unknown;
  [key: string]: unknown;
}

/**
 * 发一次 KG GET 请求，返回解析后的 JSON body
 * 失败自动重试；超出次数抛错
 */
export const kgRequest = async <T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> => {
  const maxRetry = options.retry ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: options.headers,
      });
      if (res.status !== 200) {
        lastError = new Error(`KG HTTP ${res.status}`);
        continue;
      }
      const body = (await res.json()) as KGRawBody;
      const code = body.error_code ?? body.errcode ?? body.err_code ?? 0;
      if (code !== 0) {
        lastError = new Error(`KG API error_code=${code}`);
        continue;
      }
      return body as T;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("KG request failed");
};
