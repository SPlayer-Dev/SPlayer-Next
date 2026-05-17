/**
 * 喜欢歌曲 id 列表
 *
 * params:
 * - uid  用户 id
 *
 * 响应：`{ code, checkPoint, ids: number[] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const likelist: NeteaseModule = (query, request) => {
  const data = { uid: query.uid };
  return request("/api/song/like/get", data, createOption(query, "weapi"));
};

export default likelist;
