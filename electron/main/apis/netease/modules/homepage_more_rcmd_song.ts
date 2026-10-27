/**
 * 心动模式「更多推荐」
 *
 * params:
 * - songIds 当前播放列表歌曲 id
 * - currentPlaySongId 当前播放歌曲 id
 * - source 来源，缺省 curlist_more_rcmd
 *
 * 响应：`{ code, data: { songList, algMap } }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const homepageMoreRcmdSong: NeteaseModule = (query, request) => {
  const data = {
    songIds: query.songIds,
    currentPlaySongId: query.currentPlaySongId,
    source: query.source ?? "curlist_more_rcmd",
  };
  return request("/api/homepage/more/rcmd/song", data, createOption(query, "weapi"));
};

export default homepageMoreRcmdSong;
