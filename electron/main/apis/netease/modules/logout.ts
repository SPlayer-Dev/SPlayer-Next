/**
 * 退出登录
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const logout: NeteaseModule = (query, request) =>
  request("/api/logout", {}, createOption(query));

export default logout;
