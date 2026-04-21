/**
 * 用户详情（新版，eapi）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const userDetailNew: NeteaseModule = (query, request) => {
  const data = { all: "true", userId: query.uid };
  return request(`/api/w/v1/user/detail/${query.uid}`, data, createOption(query, "eapi"));
};

export default userDetailNew;
