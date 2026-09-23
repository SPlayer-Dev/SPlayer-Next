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
  file?: {
    media_mid?: string;
    size_128mp3?: number;
    size_320mp3?: number;
    size_ape?: number;
    size_flac?: number;
    size_192ogg?: number;
    size_new?: number[];
    hires_sample?: number;
    hires_bitdepth?: number;
  };
  pay?: {
    pay_month?: number;
    pay_play?: number;
    price_album?: number;
  };
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
        mediaMid: song.file?.media_mid ?? "",
        pay: {
          payalbum: song.pay?.pay_month === 0 && (song.pay.price_album ?? 0) > 0 ? 1 : 0,
          payplay: song.pay?.pay_play ?? 0,
        },
        size128: song.file?.size_128mp3 ?? 0,
        size320: song.file?.size_320mp3 ?? 0,
        sizeApe: song.file?.size_ape ?? 0,
        sizeFlac: song.file?.size_flac ?? 0,
        sizeOgg: song.file?.size_192ogg ?? 0,
        sizeHiRes: song.file?.size_new?.[0] ?? 0,
        hiResSampleRate: song.file?.hires_sample ?? 0,
        hiResBitDepth: song.file?.hires_bitdepth ?? 0,
      },
    ];
  });
  return { code: 200, mid: data.albumMid ?? mid, total: data.totalNum ?? songs.length, songs };
};

export default album;
