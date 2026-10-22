import { createWebOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/**
 * 切换专辑收藏状态，凭据由公共请求层按路径装配
 * @param query - 专辑 ID 和操作类型
 * @param request - 统一 API 请求入口
 * @returns 服务端收藏结果
 */
const albumSub: NeteaseModule = (query, request) => {
  const path = Number(query.t ?? 1) === 2 ? "/api/album/unsub" : "/api/album/sub";
  const data = { id: query.id };
  return request(path, data, createWebOption(query));
};

export default albumSub;
