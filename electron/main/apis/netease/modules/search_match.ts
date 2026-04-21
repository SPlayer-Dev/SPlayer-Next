/**
 * 本地歌曲匹配（根据 title/album/artist/duration 猜云端对应歌曲）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const searchMatch: NeteaseModule = (query, request) => {
  const songs = [
    {
      title: query.title || "",
      album: query.album || "",
      artist: query.artist || "",
      duration: query.duration || 0,
      persistId: query.md5,
    },
  ];
  const data = { songs: JSON.stringify(songs) };
  return request("/api/search/match/new", data, createOption(query));
};

export default searchMatch;
