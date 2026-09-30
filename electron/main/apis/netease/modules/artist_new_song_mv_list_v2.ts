/** 关注歌手的新歌曲发布流（需登录） */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const artistNewSongMvListV2: NeteaseModule = (query, request) => {
  const data = {
    startTimestamp: query.startTimestamp || Date.now(),
    sourceType: query.sourceType || 1,
    limit: query.limit || 10,
    firstRequest: query.firstRequest ?? true,
  };
  return request("/api/sub/artist/new/works/song-mv/list/v2", data, createOption(query, "eapi"));
};

export default artistNewSongMvListV2;
