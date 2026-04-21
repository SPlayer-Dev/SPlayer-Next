/**
 * 登录态刷新（延长 MUSIC_U 有效期）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const loginRefresh: NeteaseModule = async (query, request) => {
  const result = await request("/api/login/token/refresh", {}, createOption(query));
  const body = result.body as { code?: number; [key: string]: unknown };
  if (body.code === 200) {
    return {
      status: 200,
      body: { ...body, cookie: result.cookie.join(";") },
      cookie: result.cookie,
    };
  }
  return result;
};

export default loginRefresh;
