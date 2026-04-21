/**
 * 注册匿名态（获取 MUSIC_A）
 *
 * 逻辑来源：@neteasecloudmusicapienhanced/api module/register_anonimous.js
 * - 生成 52 位 hex deviceId
 * - 用 `${deviceId} ${md5(deviceId ^ ID_XOR_KEY_1)}` 做 Base64 作为 username
 * - 调用 weapi 注册，将返回的 MUSIC_A 缓存到设备态
 */

import { createHash } from "node:crypto";
import { createOption } from "../core/option";
import { regenerateDeviceId, setAnonymousToken } from "../core/device";
import type { NeteaseModule } from "../core/types";

const ID_XOR_KEY = "3go8&$8*3*3h0k(2)2";

const encodeId = (deviceId: string): string => {
  let xored = "";
  for (let i = 0; i < deviceId.length; i++) {
    xored += String.fromCharCode(deviceId.charCodeAt(i) ^ ID_XOR_KEY.charCodeAt(i % ID_XOR_KEY.length));
  }
  return createHash("md5").update(xored, "utf8").digest("base64");
};

const registerAnonimous: NeteaseModule = async (query, request) => {
  const deviceId = regenerateDeviceId();
  const username = Buffer.from(`${deviceId} ${encodeId(deviceId)}`, "utf8").toString("base64");
  const data = { username };

  const result = await request("/api/register/anonimous", data, createOption(query, "weapi"));
  const body = result.body as { code?: number; [key: string]: unknown };

  if (body.code === 200) {
    if (typeof body.token === "string") setAnonymousToken(body.token);
    return {
      status: 200,
      body: { ...body, cookie: result.cookie.join(";") },
      cookie: result.cookie,
    };
  }
  return result;
};

export default registerAnonimous;
