/**
 * 乐谱列表
 *
 * params:
 * - id 歌曲 id
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const sheet_list: NeteaseModule = (query, request) => {
  const data = { id: query.id, abTest: query.ab || "b" };
  return request("/api/music/sheet/list/v1", data, createOption(query, "eapi"));
};

export default sheet_list;
