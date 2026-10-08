/**
 * 红心 / 取消红心歌曲（v1 新版，走 xeapi v3 签名）
 *
 * params:
 * - id    歌曲 id
 * - like  true 红心，false 取消
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const like_v1: NeteaseModule = (query, request) => {
  const isLike = query.like !== false && query.like !== "false";
  const data = {
    alg: "itembased",
    trackId: String(query.id),
    like: isLike,
    time: "3",
  };
  return request("/api/v1/radio/like", data, createOption(query, "xeapi", "v3"));
};

export default like_v1;
