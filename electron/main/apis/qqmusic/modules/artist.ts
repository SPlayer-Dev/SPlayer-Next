/** QM 歌手详情、热门歌曲与专辑 */

import { qmRequest } from "../core/request";
import { formatSingerName } from "../core/config";
import type { QMModule } from "../core/types";

interface SingerSong {
  id?: number;
  mid?: string;
  title?: string;
  name?: string;
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

interface SingerSongList {
  singerMid?: string;
  totalNum?: number;
  songList?: Array<{ songInfo?: SingerSong }>;
}

interface SingerAlbum {
  album_mid?: string;
  album_name?: string;
  singer_name?: string;
  pub_time?: string;
  latest_song?: { song_count?: number };
}

const artist: QMModule = async (params) => {
  const mid = String(params.mid ?? "");
  if (!mid) return { code: 400, message: "mid required" };
  const offset = Number(params.offset ?? 0);
  const limit = Number(params.limit ?? 50);
  const includeAlbums = params.includeAlbums !== false;

  const songsPromise = qmRequest<SingerSongList>(
    "musichall.song_list_server",
    "GetSingerSongList",
    { singerMid: mid, order: 1, begin: offset, num: limit },
    { session: false },
  );
  const albumsPromise = includeAlbums
    ? qmRequest<{ list?: SingerAlbum[]; total?: number }>(
        "music.web_singer_info_svr",
        "get_singer_album",
        { singermid: mid, order: "time", begin: 0, num: 200, exstatus: 1 },
        { session: false },
      )
    : Promise.resolve({ list: [], total: 0 });
  const [songsData, albumsData] = await Promise.all([songsPromise, albumsPromise]);

  const songs = (songsData.songList ?? []).flatMap((entry) => {
    const song = entry.songInfo;
    if (!song?.mid) return [];
    return [
      {
        id: String(song.id ?? ""),
        mid: song.mid,
        name: song.title ?? song.name ?? "",
        artist: formatSingerName(song.singer),
        artists: song.singer ?? [],
        album: song.album?.name ?? "",
        albumMid: song.album?.mid ?? "",
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
  const albums = (albumsData.list ?? []).map((album) => ({
    id: album.album_mid ?? "",
    name: album.album_name ?? "",
    artist: album.singer_name ?? "",
    trackCount: album.latest_song?.song_count ?? 0,
    publishTime: album.pub_time,
  }));
  return {
    code: 200,
    artist: {
      mid: songsData.singerMid ?? mid,
      name: albums[0]?.artist ?? "",
      songCount: songsData.totalNum ?? songs.length,
      albumCount: albumsData.total ?? albums.length,
    },
    songs,
    albums,
  };
};

export default artist;
