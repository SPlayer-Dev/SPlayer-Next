/**
 * 关注列表（TA 关注的人）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const userFollows: NeteaseModule = (query, request) => {
  const data = {
    offset: query.offset ?? 0,
    limit: query.limit ?? 30,
    order: true,
  };
  return request(`/api/user/getfollows/${query.uid}`, data, createOption(query, "weapi"));
};

export default userFollows;
