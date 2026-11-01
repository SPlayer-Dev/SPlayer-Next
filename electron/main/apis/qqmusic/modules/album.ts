/** QM 专辑歌曲列表 */

import { qmRequest } from "../core/request";
import { normalizeQMSong, type QMAudioInfo } from "../core/song";
import type { QMModule } from "../core/types";

interface AlbumResponse {
  songList?: Array<{ songInfo?: QMAudioInfo }>;
  totalNum?: number;
  albumMid?: string;
}

/**
 * 获取 QM 专辑歌曲并统一歌曲字段
 * @param params - 包含专辑 MID 的请求参数
 * @returns 专辑标识、歌曲总数与歌曲列表
 */
const album: QMModule = async (params) => {
  const mid = String(params.mid ?? "");
  if (!mid) return { code: 400, message: "mid required" };

  const data = await qmRequest<AlbumResponse>(
    "music.musichallAlbum.AlbumSongList",
    "GetAlbumSongList",
    { albumMid: mid, albumID: 0, begin: 0, num: 999, order: 2 },
  );
  const songs = (data.songList ?? []).flatMap((entry) => {
    const song = entry.songInfo;
    if (!song?.mid) return [];
    return [normalizeQMSong(song, mid)];
  });
  return { code: 200, mid: data.albumMid ?? mid, total: data.totalNum ?? songs.length, songs };
};

export default album;
