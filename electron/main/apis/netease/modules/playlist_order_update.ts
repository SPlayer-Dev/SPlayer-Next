/**
 * 调整歌单全局顺序（自建 + 收藏）
 *
 * params:
 * - ids  期望全局顺序的歌单 id 数组字符串，如 `[111,222]`
 *
 * 响应：`{ code }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const playlistOrderUpdate: NeteaseModule = (query, request) => {
  const data = { ids: query.ids };
  return request("/api/playlist/order/update", data, createOption(query, "weapi"));
};

export default playlistOrderUpdate;
