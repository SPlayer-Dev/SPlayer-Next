/**
 * 搜索指定播客内的声音
 *
 * params:
 * - rid 播客 ID
 * - keyword 搜索关键词
 * - limit / offset 分页
 */

import { UA_MAP } from "../core/config";
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const djProgramSearch: NeteaseModule = (query, request) => {
  const data = {
    radioId: query.rid,
    keyword: query.keyword,
    limit: query.limit ?? 200,
    offset: query.offset ?? 0,
  };
  const option = createOption(query, "eapi");
  option.ua ||= UA_MAP.api.pc;
  return request("/api/dj/radio/program/search", data, option);
};

export default djProgramSearch;
