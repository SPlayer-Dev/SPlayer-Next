/**
 * 用户云盘歌曲列表
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const userCloud: NeteaseModule = (query, request) => {
  const data = {
    limit: query.limit ?? 30,
    offset: query.offset ?? 0,
  };
  return request("/api/v1/cloud/get", data, createOption(query, "weapi"));
};

export default userCloud;
