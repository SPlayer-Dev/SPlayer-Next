/**
 * 当前登录账号信息
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const userAccount: NeteaseModule = (query, request) =>
  request("/api/nuser/account/get", {}, createOption(query, "weapi"));

export default userAccount;
