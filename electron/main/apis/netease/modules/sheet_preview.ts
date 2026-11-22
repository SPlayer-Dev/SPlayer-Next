/**
 * 乐谱预览图
 *
 * params:
 * - id 乐谱 id
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const sheet_preview: NeteaseModule = (query, request) => {
  const data = { id: query.id };
  return request("/api/music/sheet/preview/info", data, createOption(query, "eapi"));
};

export default sheet_preview;
