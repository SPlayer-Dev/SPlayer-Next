/**
 * KG API 渲染端
 *
 * 用 Proxy 代理所有接口到主进程：`kugou.search({keywords})` 等于
 * `window.api.apis.call("kugou", "search", {keywords})`。
 *
 * 调用约定：成功 → 返回 data；失败 → 抛 Error。
 */

import type { ApiCallResponse } from "@shared/types/apis";

/**
 * 调用 KG API，返回业务数据
 * @param name 接口名（search / lyric）
 * @param params 接口参数
 */
export const kugouCall = async <T = unknown>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res: ApiCallResponse = await window.api.apis.call("kugou", name, params);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
};

type KugouProxy = Record<string, <T = unknown>(params?: Record<string, unknown>) => Promise<T>>;

/** 任意方法调用：`kugou.search(...)` / `kugou.lyric(...)` */
export const kugou: KugouProxy = new Proxy({} as KugouProxy, {
  get:
    (_t, name: string) =>
    <T = unknown>(params?: Record<string, unknown>) =>
      kugouCall<T>(name, params),
});
