/**
 * 收藏或取消收藏播客
 *
 * params:
 * - rid 播客 ID
 * - t 1 收藏，0 取消收藏
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const djSub: NeteaseModule = (query, request) => {
  const action = Number(query.t) === 1 ? "sub" : "unsub";
  return request(`/api/djradio/${action}`, { id: query.rid }, createOption(query, "weapi"));
};

export default djSub;
