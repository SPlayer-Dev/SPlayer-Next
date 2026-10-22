import { createWebOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/**
 * 切换歌单订阅状态，凭据由公共请求层按路径装配
 * @param query - 歌单 ID 和操作类型
 * @param request - 统一 API 请求入口
 * @returns 服务端收藏结果
 */
const playlistSubscribe: NeteaseModule = (query, request) => {
  const action = Number(query.t ?? 1) === 2 ? "unsubscribe" : "subscribe";
  return request(`/api/playlist/${action}`, { id: query.id }, createWebOption(query));
};

export default playlistSubscribe;
