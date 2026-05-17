/**
 * 歌手信息与热门歌曲
 *
 * params:
 * - id 歌手 id
 *
 * 响应：`{ code, artist: {...}, hotSongs: NeteaseSong[], more }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const artists: NeteaseModule = (query, request) =>
  request(`/api/v1/artist/${query.id}`, {}, createOption(query, "weapi"));

export default artists;
