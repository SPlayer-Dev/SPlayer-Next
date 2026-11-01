/** 响应统一结构 */
export interface RequestResponse {
  status: number;
  body: Record<string, unknown>;
  cookie: string[];
}

/** 非 200 响应抛出的错误 */
export class NeteaseRequestError extends Error {
  readonly response: RequestResponse;

  /**
   * 保留服务端业务结果，供调用方识别失败原因
   * @param response - 未成功的请求响应
   * @param options - 底层错误原因与真实 HTTP 状态，用于区分网络失败和网关错误
   */
  constructor(response: RequestResponse, options?: ErrorOptions & { httpStatus?: number }) {
    const body = response.body as { code?: number | string; msg?: string; message?: string };
    const code = body?.code ?? response.status;
    const msg = body?.msg ?? body?.message ?? "";
    const prefix =
      options?.httpStatus !== undefined && options.httpStatus !== 200
        ? `netease HTTP ${options.httpStatus} (code ${code})`
        : `netease ${code}`;
    super(msg ? `${prefix}: ${msg}` : prefix, options);
    this.name = "NeteaseRequestError";
    this.response = response;
  }
}
