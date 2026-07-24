import type { Playlist, Track } from "@shared/types/player";
import { qqmusic as qmApi } from "@/apis/qqmusic";
import { qqSongsToTracks, type QMSong } from "@/utils/format/qqmusic";

interface PlaylistResponse {
  code?: number;
  message?: string;
  id?: string | number;
  name?: string;
  description?: string;
  creator?: string;
  cover?: string;
  total?: number;
  songs?: QMSong[];
}

export const fetchQQMusicPlaylist = async (
  id: string,
  fallbackName: string,
): Promise<{ playlist: Playlist; tracks: Track[] }> => {
  const body = await qmApi.song_list<PlaylistResponse>({ id });
  if (body.code !== 200) throw new Error(body.message || `QM 歌单请求失败: ${body.code}`);
  const tracks = qqSongsToTracks(body.songs);
  return {
    playlist: {
      id: String(body.id ?? id),
      name: body.name || fallbackName,
      cover: body.cover || tracks[0]?.cover,
      description: body.description,
      owner: body.creator,
      trackCount: body.total ?? tracks.length,
    },
    tracks,
  };
};
