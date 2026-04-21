/**
 * 听歌排行
 * type: 1 最近一周；0 所有时间
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const userRecord: NeteaseModule = (query, request) => {
  const data = {
    uid: query.uid,
    type: query.type ?? 0,
  };
  return request("/api/v1/play/record", data, createOption(query, "weapi"));
};

export default userRecord;
