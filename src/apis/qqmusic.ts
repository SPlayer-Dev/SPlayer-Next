/**
 * QM API 渲染端
 *
 * 用 Proxy 代理所有接口到主进程：`qqmusic.search({keywords})` 等于
 * `window.api.apis.call("qqmusic", "search", {keywords})`。
 *
 * 调用约定：成功 → 返回 data；失败 → 抛 Error。
 */

import type { ApiCallResponse } from "@shared/types/apis";

/**
 * 调用 QM API，返回业务数据
 * @param name 接口名（search / song_info / lyric / match / leaderboard / song_list）
 * @param params 接口参数
 */
export const qqmusicCall = async <T = unknown>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res: ApiCallResponse = await window.api.apis.call("qqmusic", name, params);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
};

type QQMusicProxy = Record<string, <T = unknown>(params?: Record<string, unknown>) => Promise<T>>;

/** 任意方法调用：`qqmusic.search(...)` / `qqmusic.lyric(...)` */
export const qqmusic: QQMusicProxy = new Proxy({} as QQMusicProxy, {
  get:
    (_t, name: string) =>
    <T = unknown>(params?: Record<string, unknown>) =>
      qqmusicCall<T>(name, params),
});
