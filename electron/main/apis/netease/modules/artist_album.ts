/**
 * 歌手专辑列表
 *
 * params:
 * - id     歌手 id
 * - limit  返回数量，默认 30
 * - offset 偏移
 *
 * 响应：`{ code, hotAlbums: [...], more, artist }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const artistAlbum: NeteaseModule = (query, request) => {
  const data = {
    limit: query.limit ?? 30,
    offset: query.offset ?? 0,
    total: true,
  };
  return request(`/api/artist/albums/${query.id}`, data, createOption(query, "weapi"));
};

export default artistAlbum;
