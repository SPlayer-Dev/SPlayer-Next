/**
 * 歌手全部歌曲（分页）
 *
 * params:
 * - id     歌手 id
 * - order  排序：hot（热门，默认） / time（时间）
 * - limit  返回数量，默认 50
 * - offset 偏移
 *
 * 响应：`{ code, songs: NeteaseSong[], more, total }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const artistSongs: NeteaseModule = (query, request) => {
  const data = {
    id: query.id,
    private_cloud: "true",
    work_type: 1,
    order: query.order ?? "hot",
    offset: query.offset ?? 0,
    limit: query.limit ?? 50,
  };
  return request("/api/v1/artist/songs", data, createOption(query, "weapi"));
};

export default artistSongs;
