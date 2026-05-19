/**
 * 删除云盘歌曲
 *
 * params:
 * - id  歌曲 id 或 id 列表
 * 响应：`{ code }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const userCloudDel: NeteaseModule = (query, request) => {
  const raw = query.id;
  const ids = Array.isArray(raw) ? raw : [raw];
  const data = { songIds: JSON.stringify(ids) };
  return request("/api/cloud/del", data, createOption(query, "weapi"));
};

export default userCloudDel;
