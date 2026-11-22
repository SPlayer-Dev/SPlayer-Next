/**
 * 歌曲首次聆听与播放故事
 *
 * params:
 * - songId 歌曲 id
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const music_first_listen_info: NeteaseModule = (query, request) => {
  const data = { songId: query.songId };
  return request(
    "/api/content/activity/music/first/listen/info",
    data,
    createOption(query, "eapi"),
  );
};

export default music_first_listen_info;
