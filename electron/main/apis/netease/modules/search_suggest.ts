/**
 * 搜索建议（web / mobile）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const searchSuggest: NeteaseModule = (query, request) => {
  const data = { s: query.keywords || "" };
  const type = query.type === "mobile" ? "keyword" : "web";
  return request(`/api/search/suggest/${type}`, data, createOption(query, "weapi"));
};

export default searchSuggest;
