import { createWebOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/**
 * 切换歌手收藏状态，凭据由公共请求层按路径装配
 * @param query - 歌手 ID 和操作类型
 * @param request - 统一 API 请求入口
 * @returns 服务端收藏结果
 */
const artistSub: NeteaseModule = (query, request) => {
  const path = Number(query.t ?? 1) === 2 ? "/api/artist/unsub" : "/api/artist/sub";
  const data = { artistId: query.id, artistIds: `[${query.id}]` };
  return request(path, data, createWebOption(query));
};

export default artistSub;
