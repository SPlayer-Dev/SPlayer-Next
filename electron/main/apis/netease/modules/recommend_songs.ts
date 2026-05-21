/**
 * 每日推荐歌曲（每日 30 首，需登录）
 *
 * 响应：`{ code, data: { dailySongs: NeteaseSong[], recommendReasons } }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const recommendSongs: NeteaseModule = (query, request) => {
  if (query.cookie && typeof query.cookie === "object") {
    (query.cookie as Record<string, string>).os = "ios";
  }
  return request("/api/v3/discovery/recommend/songs", {}, createOption(query, "weapi"));
};

export default recommendSongs;
