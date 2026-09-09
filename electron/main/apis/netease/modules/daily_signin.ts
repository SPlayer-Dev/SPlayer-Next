/**
 * 每日签到（0=安卓端得 3 经验，1=web/PC 端得 2 经验）
 * 成功 `{android: {point: 3, code: 200}, web: {point: 2, code: 200}}`，
 * 重复签到 / 未登录时对应 code 为 -2 / 301
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const dailySignin: NeteaseModule = (query, request) =>
  request("/api/point/dailyTask", { type: query.type || 0 }, createOption(query, "weapi"));

export default dailySignin;
