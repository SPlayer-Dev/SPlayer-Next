import type { Album, Track } from "@shared/types/player";
import { qqmusic as qmApi } from "@/apis/qqmusic";
import { qqSongsToTracks, type QMSong } from "@/utils/format/qqmusic";

interface AlbumResponse {
  code?: number;
  message?: string;
  mid?: string;
  total?: number;
  songs?: QMSong[];
}

export const fetchQQMusicAlbum = async (
  mid: string,
  fallbackName: string,
): Promise<{ album: Album; tracks: Track[] }> => {
  const body = await qmApi.album<AlbumResponse>({ mid });
  if (body.code !== 200) throw new Error(body.message || `QM 专辑请求失败: ${body.code}`);
  const tracks = qqSongsToTracks(body.songs);
  const first = tracks[0];
  return {
    album: {
      id: body.mid ?? mid,
      name: first?.album?.name || fallbackName,
      cover: first?.cover,
      artist: first?.artists.map((artist) => artist.name).join(" / "),
      trackCount: body.total ?? tracks.length,
    },
    tracks,
  };
};
