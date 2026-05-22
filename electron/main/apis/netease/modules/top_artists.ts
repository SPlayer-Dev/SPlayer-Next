/**
 * 热门歌手（无需登录）
 *
 * 响应：`{ code, artists: NeteaseArtist[] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const topArtists: NeteaseModule = (query, request) => {
  const data = { offset: 0, total: true, limit: query.limit ?? 50 };
  return request("/api/artist/top", data, createOption(query, "weapi"));
};

export default topArtists;
