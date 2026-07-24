/**
 * 歌曲动态封面
 *
 * params:
 * - id   歌曲 id
 *
 * 响应：`{ code, data: { videoPlayUrl } }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const songDynamicCover: NeteaseModule = (query, request) => {
  return request("/song/dynamic/cover", { id: String(query.id) }, createOption(query));
};

export default songDynamicCover;
