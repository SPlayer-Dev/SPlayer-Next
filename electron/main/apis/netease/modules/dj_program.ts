/**
 * 播客节目列表
 *
 * params:
 * - rid 播客 ID
 * - limit / offset 分页
 * - asc 是否按时间升序
 */

import { createOption } from "../core/option";
import { UA_MAP } from "../core/config";
import type { NeteaseModule } from "../core/types";

const djProgram: NeteaseModule = (query, request) => {
  const data = {
    radioId: query.rid,
    limit: query.limit ?? 30,
    offset: query.offset ?? 0,
    asc: query.asc === true || query.asc === "true" || query.asc === 1,
  };
  const option = createOption(query, "eapi");
  option.ua ||= UA_MAP.api.pc;
  return request("/api/v6/dj/program/byradio", data, option);
};

export default djProgram;
