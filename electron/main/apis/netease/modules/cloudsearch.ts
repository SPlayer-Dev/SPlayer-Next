/**
 * 云端搜索（返回更完整的 privileges 等字段，推荐使用）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const cloudsearch: NeteaseModule = (query, request) => {
  const data = {
    s: query.keywords,
    type: query.type ?? 1,
    limit: query.limit ?? 30,
    offset: query.offset ?? 0,
    total: true,
  };
  return request("/api/cloudsearch/pc", data, createOption(query));
};

export default cloudsearch;
