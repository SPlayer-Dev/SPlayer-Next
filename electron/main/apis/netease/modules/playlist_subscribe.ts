import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/**
 * 切换歌单订阅状态
 * 网页出口会被服务端判定为非法环境，写入改用客户端 eapi 通道
 * @param query - 歌单 ID 和操作类型
 * @param request - 统一 API 请求入口
 * @returns 服务端收藏结果
 */
const playlistSubscribe: NeteaseModule = (query, request) => {
  const action = Number(query.t ?? 1) === 2 ? "unsubscribe" : "subscribe";
  return request(`/api/playlist/${action}`, { id: query.id }, createOption(query, "eapi"));
};

export default playlistSubscribe;
