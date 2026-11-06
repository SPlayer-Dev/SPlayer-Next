/**
 * 歌曲动态封面，需登录
 *
 * params:
 * - id 歌曲 id
 *
 * 响应：`{ code, data: { videoPlayUrl } }`，无动态封面时 data 为空
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const song_dynamic_cover: NeteaseModule = (query, request) =>
  request("/api/songplay/dynamic-cover", { songId: query.id }, createOption(query));

export default song_dynamic_cover;
