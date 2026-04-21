/**
 * 热门搜索（简版）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const searchHot: NeteaseModule = (query, request) =>
  request("/api/search/hot", { type: 1111 }, createOption(query));

export default searchHot;
