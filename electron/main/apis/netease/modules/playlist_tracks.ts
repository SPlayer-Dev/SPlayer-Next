/**
 * 歌单增/删歌曲
 *
 * params:
 * - op      "add" 或 "del"
 * - pid     歌单 id
 * - tracks  曲目 id 列表（逗号分隔字符串，由 wrapper 拼好）
 *
 * 响应：`{ code, count, trackIds, cloudCount }`
 *
 * 走默认 eapi。服务端 512 表示重复/受限，按 NCM 现行实现重试时把 trackIds 翻倍以强制写入
 */

import { createOption } from "../core/option";
import { NeteaseRequestError } from "../core/request";
import type { NeteaseModule } from "../core/types";

const playlistTracks: NeteaseModule = async (query, request) => {
  const tracks = String(query.tracks ?? "").split(",");
  const buildData = (ids: string[]) => ({
    op: query.op,
    pid: query.pid,
    trackIds: JSON.stringify(ids),
    imme: "true",
  });
  const isAdd = query.op === "add";
  try {
    return await request("/api/playlist/manipulate/tracks", buildData(tracks), createOption(query));
  } catch (err) {
    if (isAdd && err instanceof NeteaseRequestError) {
      const code = Number(err.response.body?.code ?? err.response.status);
      if (code !== 200) {
        return request(
          "/api/playlist/manipulate/tracks",
          buildData([...tracks, ...tracks]),
          createOption(query),
        );
      }
    }
    throw err;
  }
};

export default playlistTracks;
