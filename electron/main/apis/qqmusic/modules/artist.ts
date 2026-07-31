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

  const [songsData, albumsData] = await Promise.all([
    qmRequest<{
      songlist?: SingerSong[];
      singer_info?: { id?: number; mid?: string; name?: string };
      total_song?: number;
      total_album?: number;
    }>("music.web_singer_info_svr", "get_singer_detail_info", {
      sort: 5,
      singermid: mid,
      sin: 0,
      num: 100,
    }),
    qmRequest<{ list?: SingerAlbum[]; total?: number }>(
      "music.web_singer_info_svr",
      "get_singer_album",
      { singermid: mid, order: "time", begin: 0, num: 200, exstatus: 1 },
    ),
  ]);

  const songs = (songsData.songlist ?? []).map((song) => ({
    id: String(song.id ?? ""),
    mid: song.mid ?? "",
    name: song.title ?? song.name ?? "",
    artist: formatSingerName(song.singer),
    artists: song.singer ?? [],
    album: song.album?.name ?? "",
    albumMid: song.album?.mid ?? "",
    duration: (song.interval ?? 0) * 1000,
  }));
  const albums = (albumsData.list ?? []).map((album) => ({
    id: album.album_mid ?? "",
    name: album.album_name ?? "",
    artist: album.singer_name ?? songsData.singer_info?.name ?? "",
    trackCount: album.latest_song?.song_count ?? 0,
    publishTime: album.pub_time,
  }));
  return {
    code: 200,
    artist: {
      id: String(songsData.singer_info?.id ?? ""),
      mid: songsData.singer_info?.mid ?? mid,
      name: songsData.singer_info?.name ?? "",
      songCount: songsData.total_song ?? songs.length,
      albumCount: songsData.total_album ?? albumsData.total ?? albums.length,
    },
    songs,
    albums,
  };
};

export default artist;
