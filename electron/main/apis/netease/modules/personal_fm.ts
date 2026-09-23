/**
 * 私人 FM（需登录）
 * 服务端按用户偏好返回一批推荐曲目，通常 3 首
 *
 * 响应：`{ code, data: NeteaseSong[] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const personalFm: NeteaseModule = (query, request) => {
  const data: Record<string, unknown> = {};
  if (query.mode) data.mode = query.mode;
  if (query.submode || query.subMode) data.subMode = query.submode || query.subMode;
  if (query.limit) data.limit = query.limit;
  return request("/api/v1/radio/get", data, createOption(query, "weapi"));
};

export default personalFm;
