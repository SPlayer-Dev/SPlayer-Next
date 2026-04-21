/**
 * Netease API 渲染端
 *
 * 用 Proxy 把所有接口代理到主进程：`netease.search({keywords})` 实际等于
 * `window.api.netease.call("search", {keywords})`。
 *
 * 调用约定：成功 → 返回 body；失败 → 抛 Error。
 * 想取原始响应（含 HTTP status）用 `neteaseRaw`。
 */

import type { NeteaseCallResponse } from "@shared/types/netease";

/**
 * 调用 Netease API，返回原始响应
 * @param name 接口名
 * @param params 接口参数
 * @returns 原始响应
 */
export const neteaseRaw = async (
  name: string,
  params?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> => {
  const res: NeteaseCallResponse = await window.api.netease.call(name, params);
  if (!res.ok) throw new Error(res.error);
  return { status: res.status, body: res.body };
};

/**
 * 调用 Netease API，只返回 body
 * @param name 接口名
 * @param params 接口参数
 * @returns body
 */
export const neteaseCall = async <T = unknown>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res = await neteaseRaw(name, params);
  return res.body as T;
};

type NeteaseProxy = Record<string, <T = unknown>(params?: Record<string, unknown>) => Promise<T>>;

/**
 * 任意方法调用：`netease.search(...)` / `netease.song_url_v1(...)`
 * @param name 接口名
 * @param params 接口参数
 * @returns body
 */
export const netease: NeteaseProxy = new Proxy({} as NeteaseProxy, {
  get:
    (_t, name: string) =>
    <T = unknown>(params?: Record<string, unknown>) =>
      neteaseCall<T>(name, params),
});
