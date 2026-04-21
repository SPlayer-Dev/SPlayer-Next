/**
 * 用户收藏计数（歌单/专辑/MV 等）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const userSubcount: NeteaseModule = (query, request) =>
  request("/api/subcount", {}, createOption(query, "weapi"));

export default userSubcount;
