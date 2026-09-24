/**
 * 所有关注歌手最近的 50 首新歌（需登录）
 *
 * 响应：`{ code, data: { count, songList: NeteaseSong[] } }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const artistNewSongPlayall: NeteaseModule = (query, request) =>
  request("/api/sub/artist/new/works/song/playall", {}, createOption(query, "eapi"));

export default artistNewSongPlayall;
