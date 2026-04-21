/**
 * 手机号登录（密码或验证码均可）
 */

import { createHash } from "node:crypto";
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const md5 = (text: string): string => createHash("md5").update(text).digest("hex");

const loginCellphone: NeteaseModule = async (query, request) => {
  const hasCaptcha = Boolean(query.captcha);
  const data: Record<string, unknown> = {
    type: "1",
    https: "true",
    phone: query.phone,
    countrycode: query.countrycode || "86",
    captcha: query.captcha,
    remember: "true",
  };
  if (hasCaptcha) {
    data.captcha = query.captcha;
  } else {
    data.password = (query.md5_password as string) || md5((query.password as string) || "");
  }

  let result = await request("/api/w/login/cellphone", data, createOption(query, "weapi"));
  const body = result.body as { code?: number; [key: string]: unknown };

  if (body.code === 200) {
    const renamed = JSON.parse(JSON.stringify(body).replace(/avatarImgId_str/g, "avatarImgIdStr"));
    result = {
      status: 200,
      body: { ...renamed, cookie: result.cookie.join(";") },
      cookie: result.cookie,
    };
  }
  return result;
};

export default loginCellphone;
