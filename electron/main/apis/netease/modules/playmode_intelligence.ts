/**
 * 心动模式 / 智能播放列表
 *
 * params:
 * - id           种子歌曲 id
 * - pid          歌单 id（通常为「我喜欢的音乐」）
 * - sid          起始歌曲 id，缺省取 id
 * - type         fromPlayOne / fromPlayAll，缺省 fromPlayOne
 * - count        推荐批次数，缺省 1；传歌单长度时与桌面端一致
 * - starPlaylist 完整歌单，桌面端心动模式会携带
 * - uid          用户 id
 *
 * count 字段服务端必传，缺省取 1，否则返回 500。
 *
 * 响应：`{ code, data: [{ songInfo: NeteaseSong, recommended, alg }] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const playmodeIntelligence: NeteaseModule = (query, request) => {
  const data = {
    songId: query.id,
    type: query.type ?? "fromPlayOne",
    playlistId: query.pid,
    startMusicId: query.sid ?? query.id,
    count: query.count ?? 1,
    ...(query.starPlaylist !== undefined ? { starPlaylist: query.starPlaylist } : {}),
    ...(query.uid !== undefined ? { uid: query.uid } : {}),
  };
  return request("/api/playmode/intelligence/list", data, createOption(query, "weapi"));
};

export default playmodeIntelligence;
