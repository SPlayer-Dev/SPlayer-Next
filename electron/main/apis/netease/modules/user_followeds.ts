/**
 * 粉丝列表（关注 TA 的人）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const userFolloweds: NeteaseModule = (query, request) => {
  const data = {
    userId: query.uid,
    time: "0",
    limit: query.limit ?? 20,
    offset: query.offset ?? 0,
    getcounts: "true",
  };
  return request(`/api/user/getfolloweds/${query.uid}`, data, createOption(query));
};

export default userFolloweds;
