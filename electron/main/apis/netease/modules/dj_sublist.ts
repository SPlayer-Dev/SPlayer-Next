/**
 * 用户收藏的播客列表
 *
 * params:
 * - limit / offset 分页
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const djSublist: NeteaseModule = (query, request) => {
  const data = {
    limit: query.limit ?? 30,
    offset: query.offset ?? 0,
    total: true,
    timestamp: query.timestamp ?? Date.now(),
  };
  return request("/api/djradio/get/subed", data, createOption(query, "weapi"));
};

export default djSublist;
