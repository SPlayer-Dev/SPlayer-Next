/** QM 专辑歌曲列表 */

import { qmRequest } from "../core/request";
import { formatSingerName } from "../core/config";
import type { QMModule } from "../core/types";

interface AlbumSong {
  id?: number;
  mid?: string;
  title?: string;
  interval?: number;
  singer?: Array<{ id?: number; mid?: string; name?: string }>;
  album?: { mid?: string; name?: string };
}

interface AlbumResponse {
  songList?: Array<{ songInfo?: AlbumSong }>;
  totalNum?: number;
  albumMid?: string;
}

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
    return [
      {
        id: String(song.id ?? ""),
        mid: song.mid,
        name: song.title ?? "",
        artist: formatSingerName(song.singer),
        artists: song.singer ?? [],
        album: song.album?.name ?? "",
        albumMid: song.album?.mid ?? mid,
        duration: (song.interval ?? 0) * 1000,
      },
    ];
  });
  return { code: 200, mid: data.albumMid ?? mid, total: data.totalNum ?? songs.length, songs };
};

export default album;
