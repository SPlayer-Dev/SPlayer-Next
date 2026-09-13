/**
 * 获取歌曲动态封面
 *
 * params:
 * - id   歌曲 id
 *
 * 响应：`{ code, data: { videoPlayUrl, ... } }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const song_dynamic_cover: NeteaseModule = (query, request) => {
  const data = { songId: query.id };
  return request("/api/songplay/dynamic-cover", data, createOption(query));
};

export default song_dynamic_cover;
