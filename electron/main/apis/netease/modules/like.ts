/**
 * 红心 / 取消红心歌曲（旧版 weapi 接口）
 *
 * params:
 * - id    歌曲 id
 * - like  true 红心，false 取消
 *
 * 响应：`{ code, songs: [], playlistId }`
 * code !== 200 表示失败（如未登录、网络风控等）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const like: NeteaseModule = (query, request) => {
  const isLike = query.like !== false && query.like !== "false";
  const data = {
    alg: "itembased",
    trackId: String(query.id),
    like: isLike,
    time: "3",
  };
  return request("/api/radio/like", data, createOption(query, "weapi"));
};

export default like;
