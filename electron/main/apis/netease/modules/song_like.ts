import { createWebOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/**
 * 切换歌曲红心，凭据和业务状态码由公共请求层处理
 * @param query - 曲目 ID、账号 ID 和目标红心状态
 * @param request - 统一 API 请求入口
 * @returns 服务端收藏结果
 */
const songLike: NeteaseModule = (query, request) =>
  request(
    "/api/song/like",
    {
      trackId: String(query.id ?? ""),
      userid: String(query.uid ?? ""),
      like: String(query.like !== false && query.like !== "false"),
    },
    createWebOption(query),
  );

export default songLike;
