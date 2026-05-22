/**
 * 新碟上架（无需登录）
 *
 * 响应：`{ code, albums: NeteaseAlbum[] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const albumNew: NeteaseModule = (query, request) => {
  const data = { area: "ALL", offset: 0, total: true, limit: query.limit ?? 30 };
  return request("/api/album/new", data, createOption(query, "weapi"));
};

export default albumNew;
