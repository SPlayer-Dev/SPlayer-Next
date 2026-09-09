/**
 * 签到进度（连续签到天数、目标天数等）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const signinProgress: NeteaseModule = (query, request) =>
  request(
    "/api/act/modules/signin/v2/progress",
    { moduleId: query.moduleId || "1207signin-1207signin" },
    createOption(query, "weapi"),
  );

export default signinProgress;
