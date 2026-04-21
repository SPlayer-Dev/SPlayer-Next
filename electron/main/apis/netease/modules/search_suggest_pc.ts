/**
 * 搜索建议（PC 版）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const searchSuggestPc: NeteaseModule = (query, request) => {
  const data = { keyword: query.keyword || "" };
  return request("/api/search/pc/suggest/keyword/get", data, createOption(query));
};

export default searchSuggestPc;
