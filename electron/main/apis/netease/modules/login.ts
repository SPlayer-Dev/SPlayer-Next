/**
 * 邮箱登录
 */

import { createHash } from "node:crypto";
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const md5 = (text: string): string => createHash("md5").update(text).digest("hex");

const login: NeteaseModule = async (query, request) => {
  const password =
    (query.md5_password as string) || md5((query.password as string) || "");
  const data = {
    type: "0",
    https: "true",
    username: query.email as string,
    password,
    rememberLogin: "true",
  };
  let result = await request("/api/w/login", data, createOption(query));
  const body = result.body as { code?: number; [key: string]: unknown };

  if (body.code === 502) {
    return {
      status: 200,
      body: { msg: "账号或密码错误", code: 502, message: "账号或密码错误" },
      cookie: result.cookie,
    };
  }
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

export default login;
