/**
 * 用户详情（旧版）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const userDetail: NeteaseModule = async (query, request) => {
  const res = await request(`/api/v1/user/detail/${query.uid}`, {}, createOption(query, "weapi"));
  const renamed = JSON.stringify(res).replace(/avatarImgId_str/g, "avatarImgIdStr");
  return JSON.parse(renamed);
};

export default userDetail;
