/**
 * 多类型搜索（一次返回歌曲/歌手/歌单的前几条命中）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const searchMultimatch: NeteaseModule = (query, request) => {
  const data = {
    type: query.type ?? 1,
    s: query.keywords || "",
  };
  return request("/api/search/suggest/multimatch", data, createOption(query, "weapi"));
};

export default searchMultimatch;
