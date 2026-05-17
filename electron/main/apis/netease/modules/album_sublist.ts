/**
 * 用户收藏的专辑列表
 *
 * params:
 * - limit / offset 分页
 *
 * 响应：`{ code, count, hasMore, data: [{ id, name, picUrl, artists, ... }] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const albumSublist: NeteaseModule = (query, request) => {
  const data = {
    limit: query.limit ?? 50,
    offset: query.offset ?? 0,
    total: true,
  };
  return request("/api/album/sublist", data, createOption(query, "weapi"));
};

export default albumSublist;
