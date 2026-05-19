/**
 * 收藏 / 取消收藏专辑
 *
 * params:
 * - id 专辑 id
 * - t  1 收藏 / 2 取消，默认 1
 *
 * 响应：`{ code }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const albumSub: NeteaseModule = (query, request) => {
  const path = query.t === 2 ? "/api/album/sub/cancel" : "/api/album/sub";
  const data = { id: query.id };
  return request(path, data, createOption(query, "weapi"));
};

export default albumSub;
