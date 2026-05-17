/**
 * 红心 / 取消红心
 *
 * params:
 * - id    歌曲 id
 * - like  true 红心，false 取消
 *
 * 响应：`{ code, songs: [], playlistId }`
 * code !== 200 表示失败（如未登录、歌单未创建等）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const like: NeteaseModule = (query, request) => {
  const data = {
    trackId: query.id,
    like: query.like === true || query.like === "true",
    time: 3,
  };
  return request("/api/song/like", data, createOption(query, "weapi"));
};

export default like;
