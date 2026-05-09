/**
 * 流媒体客户端的错误类型
 *
 * 用具体类替代字符串模式匹配，store 的 withAutoReauth 可以用 instanceof 精确判断 */

/** 鉴权失败（HTTP 401 / accessToken 缺失或过期 / Subsonic 40-44 错误码） */
export class StreamingAuthError extends Error {
  readonly name = "StreamingAuthError";
}

/** 协议错误（响应缺字段、status != ok 等） */
export class StreamingProtocolError extends Error {
  readonly name = "StreamingProtocolError";
}

/** HTTP 错误（非 2xx，且非 401） */
export class StreamingHttpError extends Error {
  readonly name = "StreamingHttpError";
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
  }
}

/** 请求超时（fetchWithTimeout 触发的 AbortError） */
export class StreamingTimeoutError extends Error {
  readonly name = "StreamingTimeoutError";
}

/** 错误归类 */
export type StreamingErrorCode = "auth" | "network" | "protocol" | "unknown";

/**
 * 把任意 throw 出来的值归类成 StreamingErrorCode
 * @param err - catch 到的错误
 */
export const classifyError = (err: unknown): StreamingErrorCode => {
  if (err instanceof StreamingAuthError) return "auth";
  if (err instanceof StreamingTimeoutError) return "network";
  if (err instanceof StreamingHttpError) return err.status >= 500 ? "network" : "protocol";
  if (err instanceof StreamingProtocolError) return "protocol";
  // fetch 在 DNS/网络失败时抛 TypeError
  if (err instanceof TypeError) return "network";
  return "unknown";
};
