/**
 * 排行榜
 * module: musicToplist.ToplistInfoServer / GetDetail
 *
 * params:
 * - topid   榜单 ID（必填）：26 流行榜 / 27 新歌榜 / 4 飙升榜 / 62 热歌榜 等
 * - period  期数（YYYY_ww），不传取最新
 * - limit   返回条数，默认 50
 * - offset  偏移量
 */

import { qmRequest } from "../core/request";
import { formatSingerName } from "../core/config";
import type { QMModule } from "../core/types";

interface ToplistSong {
  songInfo?: {
    id?: number;
    mid?: string;
    title?: string;
    interval?: number;
    singer?: Array<{ name?: string; mid?: string }>;
    album?: { name?: string; mid?: string };
  };
}

const leaderboard: QMModule = async (params) => {
  const { topid, period = "", limit = 50, offset = 0 } = params;

  const data = await qmRequest<{
    title?: string;
    titleDetail?: string;
    updateTime?: string;
    headPicUrl?: string;
    songInfoList?: ToplistSong[];
  }>(
    "musicToplist.ToplistInfoServer",
    "GetDetail",
    {
      topid,
      num: limit,
      offset,
      period,
    },
    { auth: false },
  );

  const songs = (data?.songInfoList ?? [])
    .map((item) => item.songInfo)
    .filter((song): song is NonNullable<ToplistSong["songInfo"]> => !!song)
    .map((song) => ({
      id: String(song.id ?? ""),
      mid: song.mid ?? "",
      name: song.title ?? "",
      artist: formatSingerName(song.singer),
      album: song.album?.name ?? "",
      albumMid: song.album?.mid ?? "",
      duration: (song.interval ?? 0) * 1000,
    }));

  return {
    code: 200,
    title: data?.title ?? "",
    subTitle: data?.titleDetail ?? "",
    updateTime: data?.updateTime ?? "",
    cover: data?.headPicUrl ?? "",
    songs,
  };
};

export default leaderboard;
