/**
 * 轮询二维码扫码状态
 * - 801 待扫码、802 待确认、800 已过期、803 已确认（此时 cookie 里有 MUSIC_U）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const loginQrCheck: NeteaseModule = async (query, request) => {
  const data = { key: query.key, type: 3 };
  try {
    const result = await request("/api/login/qrcode/client/login", data, createOption(query));
    return {
      status: 200,
      body: { ...result.body, cookie: result.cookie.join(";") },
      cookie: result.cookie,
    };
  } catch (err) {
    const fallback = err as { cookie?: string[] };
    return { status: 200, body: {}, cookie: fallback?.cookie ?? [] };
  }
};

export default loginQrCheck;
