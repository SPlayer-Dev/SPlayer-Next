/**
 * 歌曲动态封面
 *
 * params:
 * - id   歌曲 id
 *
 * 响应：`{ code, data: { videoPlayUrl } }`
 *
 * 该接口为反爬明文端点（不走 eapi/weapi 加密），使用 `api` 加密模式直连 interface.music.163.com。
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const songDynamicCover: NeteaseModule = (query, request) => {
  return request("/song/dynamic/cover", { id: String(query.id) }, createOption(query, "api"));
};

export default songDynamicCover;
