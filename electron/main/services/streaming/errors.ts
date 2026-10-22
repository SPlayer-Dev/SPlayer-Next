/** 保留 HTTP / Subsonic 状态，避免将权限拒绝或网络故障当成不支持端点 */
export class StreamingRequestError extends Error {
  /**
   * 创建携带协议状态的请求错误
   * @param message - 不含凭据的失败说明
   * @param status - HTTP 状态
   * @param code - Subsonic 错误码
   */
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
  }
}

/**
 * 判断是否需要重新鉴权，权限拒绝不触发重登
 * @param error - 请求错误
 * @returns 是否为鉴权失效
 */
export const isStreamingAuthError = (error: unknown): boolean =>
  error instanceof StreamingRequestError && (error.status === 401 || error.code === 40);

/**
 * 判断可降级处理的缺失端点
 * @param error - 请求错误
 * @returns 是否不支持端点
 */
export const isUnsupportedEndpoint = (error: unknown): boolean =>
  error instanceof StreamingRequestError &&
  (error.status === 404 || error.status === 501 || error.code === 70);
