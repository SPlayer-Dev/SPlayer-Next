/**
 * 播客详情
 *
 * params:
 * - rid 播客 ID
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const djDetail: NeteaseModule = (query, request) =>
  request("/api/djradio/v2/get", { id: query.rid }, createOption(query, "weapi"));

export default djDetail;
