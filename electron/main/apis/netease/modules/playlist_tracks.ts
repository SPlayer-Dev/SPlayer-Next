import { createWebOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/**
 * 按服务端业务结果处理歌单增删，不通过重复 ID 强制补发写入
 * @param query - 歌单、操作类型和逗号分隔的曲目 ID
 * @param request - 统一 API 请求入口
 * @returns 服务端歌单变更结果
 */
const playlistTracks: NeteaseModule = (query, request) =>
  request(
    "/api/playlist/manipulate/tracks",
    {
      op: query.op,
      pid: query.pid,
      trackIds: JSON.stringify(String(query.tracks ?? "").split(",")),
      imme: "true",
    },
    createWebOption(query),
  );

export default playlistTracks;
