/**
 * 歌曲百科信息
 *
 * params:
 * - id 歌曲 id
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const song_wiki_info: NeteaseModule = (query, request) => {
  const extJson = {
    states: {
      playingResource: {
        current: query.id,
        scene: "songWiki",
      },
    },
  };
  const data = {
    extJson: JSON.stringify(extJson),
    positionCode: "songWikiMainPosition",
  };
  return request(
    "/api/link/page/parent/relation/construct/info",
    data,
    createOption(query, "eapi"),
  );
};

export default song_wiki_info;
