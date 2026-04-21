/**
 * 搜索（普通）
 * type: 1 单曲 / 10 专辑 / 100 歌手 / 1000 歌单 / 1002 用户 / 1004 MV / 1006 歌词 / 1009 电台 / 1014 视频
 * 特例：type=2000 走语音搜索接口
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const search: NeteaseModule = (query, request) => {
  if (query.type && String(query.type) === "2000") {
    const voice = {
      keyword: query.keywords,
      scene: "normal",
      limit: query.limit ?? 30,
      offset: query.offset ?? 0,
    };
    return request("/api/search/voice/get", voice, createOption(query));
  }
  const data = {
    s: query.keywords,
    type: query.type ?? 1,
    limit: query.limit ?? 30,
    offset: query.offset ?? 0,
  };
  return request("/api/search/get", data, createOption(query));
};

export default search;
