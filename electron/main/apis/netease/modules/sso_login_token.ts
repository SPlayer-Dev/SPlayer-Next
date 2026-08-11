/**
 * 获取网页单点登录使用的短期 token
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const ssoLoginToken: NeteaseModule = (query, request) =>
  request("/api/sso/login/token", {}, createOption(query, "eapi"));

export default ssoLoginToken;
