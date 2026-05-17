/**
 * 专辑详情（元数据 + 曲目）
 *
 * params:
 * - id 专辑 id
 *
 * 响应：`{ code, album: { id, name, picUrl, artists, description, ... }, songs: NeteaseSong[] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const album: NeteaseModule = (query, request) =>
  request(`/api/v1/album/${query.id}`, {}, createOption(query, "weapi"));

export default album;
