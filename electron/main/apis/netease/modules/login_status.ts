/**
 * 登录状态（当前账号信息）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const loginStatus: NeteaseModule = async (query, request) => {
  const result = await request("/api/w/nuser/account/get", {}, createOption(query, "weapi"));
  const body = result.body as { code?: number; [key: string]: unknown };
  if (body.code === 200) {
    return {
      status: 200,
      body: { data: { ...body } },
      cookie: result.cookie,
    };
  }
  return result;
};

export default loginStatus;
