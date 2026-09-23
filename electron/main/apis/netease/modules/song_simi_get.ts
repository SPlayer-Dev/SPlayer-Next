/**
 * 插播相似歌曲
 *
 * params:
 * - id 歌曲 id
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const song_simi_get: NeteaseModule = (query, request) => {
  const data = {
    positionCode: "toolBarRcmdSong",
    resourceId: query.id,
    resourceType: "song",
  };
  return request("/api/link/position/show/resource", data, createOption(query, "eapi"));
};

export default song_simi_get;
