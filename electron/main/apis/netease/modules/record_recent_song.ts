import { createWebOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/**
 * 查询服务端最近播放记录，用于比较上报前后的变化
 * @param query - 查询参数，limit 默认值为一百
 * @param request - 公共请求入口
 * @returns 服务端原始播放记录响应
 */
const recordRecentSong: NeteaseModule = (query, request) =>
  request("/api/play-record/song/list", { limit: query.limit ?? 100 }, createWebOption(query));

export default recordRecentSong;
