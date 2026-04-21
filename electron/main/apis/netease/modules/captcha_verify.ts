/**
 * 校验短信验证码
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const captchaVerify: NeteaseModule = (query, request) => {
  const data = {
    ctcode: query.ctcode || "86",
    cellphone: query.phone,
    captcha: query.captcha,
  };
  return request("/api/sms/captcha/verify", data, createOption(query, "weapi"));
};

export default captchaVerify;
