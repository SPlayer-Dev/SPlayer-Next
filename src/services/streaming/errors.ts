/**
 * 流媒体客户端的错误类型
 *
 * 用具体类替代字符串模式匹配，store 的 withAutoReauth 可以用 instanceof 精确判断。
 */

/** 鉴权失败（HTTP 401 / accessToken 缺失或过期） */
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
