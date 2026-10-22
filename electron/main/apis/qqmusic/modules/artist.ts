/** QM 歌手详情、热门歌曲与专辑 */

import { qmRequest } from "../core/request";
import { normalizeQMSong, type QMAudioInfo } from "../core/song";
import type { QMAlbumItem } from "@shared/types/platform/qqmusic";
import type { QMModule } from "../core/types";

interface SingerSongList {
  singerMid?: string;
  totalNum?: number;
  songList?: Array<{ songInfo?: QMAudioInfo }>;
}

interface SingerAlbum {
  album_mid?: string;
  album_name?: string;
  singer_name?: string;
  pub_time?: string;
  latest_song?: { song_count?: number };
}

/**
 * 获取 QM 歌手的歌曲分页与专辑列表
 * @param params - 歌手 MID、分页与专辑加载选项
 * @returns 歌手资料、歌曲与专辑列表
 */
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
    return [normalizeQMSong(song)];
  });
  const albums: QMAlbumItem[] = (albumsData.list ?? []).map((album) => ({
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
