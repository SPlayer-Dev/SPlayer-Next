/**
 * 默认搜索关键词（搜索框 placeholder）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const searchDefault: NeteaseModule = (query, request) =>
  request("/api/search/defaultkeyword/get", {}, createOption(query));

export default searchDefault;
