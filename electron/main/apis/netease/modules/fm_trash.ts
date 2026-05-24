/**
 * 私人 FM 减少推荐（不喜欢，影响后续推荐）
 *
 * params:
 * - id    歌曲 id
 * - time  已播放秒数，默认 25
 * - alg   推荐算法标识，默认 "RT"
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const fmTrash: NeteaseModule = (query, request) => {
  const data = {
    songId: query.id,
    alg: query.alg ?? "RT",
    time: query.time ?? 25,
  };
  return request("/api/radio/trash/add", data, createOption(query, "weapi"));
};

export default fmTrash;
