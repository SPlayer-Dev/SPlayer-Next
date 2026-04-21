/**
 * 用户等级（听歌时长、登录天数等）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const userLevel: NeteaseModule = (query, request) =>
  request("/api/user/level", {}, createOption(query, "weapi"));

export default userLevel;
