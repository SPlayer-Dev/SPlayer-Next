/**
 * 热搜详情（带热度/图标）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const searchHotDetail: NeteaseModule = (query, request) =>
  request("/api/hotsearchlist/get", {}, createOption(query, "weapi"));

export default searchHotDetail;
