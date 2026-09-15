/**
 * BD（BD 平台）API 渲染端
 *
 * 用 Proxy 代理所有接口到主进程：`bd.search(...)` 等于
 * `window.api.apis.call("bd", "search", ...)`。
 *
 * 调用约定：成功 → 返回 data；失败 → 抛 Error。
 */

import type { ApiCallResponse } from "@shared/types/apis";

/**
 * 调用 BD API，返回业务数据
 * @param name 接口名（search / album / artist / playlist / song_url / lyric）
 * @param params 接口参数
 */
export const bdCall = async <T = unknown>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res: ApiCallResponse = await window.api.apis.call("bd", name, params);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
};

type BdProxy = Record<string, <T = unknown>(params?: Record<string, unknown>) => Promise<T>>;

/** 任意方法调用：`bd.search(...)` / `bd.lyric(...)` */
export const bd: BdProxy = new Proxy({} as BdProxy, {
  get:
    (_t, name: string) =>
    <T = unknown>(params?: Record<string, unknown>) =>
      bdCall<T>(name, params),
});
