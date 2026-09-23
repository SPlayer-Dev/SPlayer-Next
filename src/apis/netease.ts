/**
 * Netease API 渲染端
 *
 * 用 Proxy 把所有接口代理到主进程：`netease.search({keywords})` 实际等于
 * `window.api.apis.call("netease", "search", {keywords})`
 *
 * 调用约定：成功 → 返回 body；失败 → 抛 Error
 * 想取原始响应（含 HTTP status）用 `neteaseRaw`
 */

import type { ApiCallResponse } from "@shared/types/apis";
import { isExplicitNeteaseAuthFailure } from "@/apis/neteaseAuth";

type AuthFailureListener = (error: NeteaseApiError) => void;

interface NeteaseCallOptions {
  notifyAuthFailure?: boolean;
}

let authFailureListener: AuthFailureListener | null = null;

export class NeteaseApiError extends Error {
  readonly status?: number;
  readonly body?: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "NeteaseApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * 调用 Netease API，返回原始响应
 * @param name 接口名
 * @param params 接口参数
 * @param options 调用行为
 * @returns 原始响应（含 status + body）
 */
export const neteaseRaw = async (
  name: string,
  params?: Record<string, unknown>,
  options?: NeteaseCallOptions,
): Promise<{ status: number; body: unknown }> => {
  const res: ApiCallResponse = await window.api.apis.call("netease", name, params);
  if (!res.ok) {
    const error = new NeteaseApiError(res.error, res.status, res.body);
    if (
      options?.notifyAuthFailure !== false &&
      name !== "login_status" &&
      isExplicitNeteaseAuthFailure(error)
    ) {
      authFailureListener?.(error);
    }
    throw error;
  }
  return { status: res.status ?? 200, body: res.body };
};

/**
 * 调用 Netease API，只返回 body
 * @param name 接口名
 * @param params 接口参数
 * @param options 调用行为
 */
export const neteaseCall = async <T = any>(
  name: string,
  params?: Record<string, unknown>,
  options?: NeteaseCallOptions,
): Promise<T> => {
  const res = await neteaseRaw(name, params, options);
  return res.body as T;
};

type NeteaseProxy = Record<string, <T = any>(params?: Record<string, unknown>) => Promise<T>>;

/**
 * 任意方法调用：`netease.search(...)` / `netease.song_url_v1(...)`
 */
export const netease: NeteaseProxy = new Proxy({} as NeteaseProxy, {
  get:
    (_t, name: string) =>
    <T = any>(params?: Record<string, unknown>) =>
      neteaseCall<T>(name, params),
});

/** 清空登录态 cookie */
export const clearNeteaseSession = (): Promise<void> => window.api.apis.clearSession("netease");

/**
 * 订阅服务端明确返回的登录失效
 * @param listener - 登录失效回调
 * @returns 取消订阅函数
 */
export const onNeteaseAuthFailure = (listener: AuthFailureListener): (() => void) => {
  authFailureListener = listener;
  return () => {
    if (authFailureListener === listener) authFailureListener = null;
  };
};
