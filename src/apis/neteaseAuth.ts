/** 接口失败信息 */
export interface NeteaseFailure {
  status?: number;
  body?: unknown;
  message?: string;
}

const readBody = (body: unknown): { code?: unknown; msg?: unknown; message?: unknown } =>
  body && typeof body === "object"
    ? (body as { code?: unknown; msg?: unknown; message?: unknown })
    : {};

/**
 * 判断响应是否明确表示登录态失效
 * @param failure - 接口状态、响应体与错误消息
 * @returns 仅在服务端明确要求登录时返回 true
 */
export const isExplicitNeteaseAuthFailure = (failure: NeteaseFailure): boolean => {
  const body = readBody(failure.body);
  const code = Number(body.code ?? failure.status);
  if (code === 301) return true;

  const message = [body.msg, body.message, failure.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return /未登录|需要登录|请先登录|登录(?:状态|凭据|cookie)?(?:已)?(?:失效|过期)|need.?login|not.?login|login required|(?:login|session|cookie).*(?:expired|invalid|unauthori[sz]ed)|unauthori[sz]ed.*(?:login|session|cookie)|invalid.*cookie/i.test(
    message,
  );
};
