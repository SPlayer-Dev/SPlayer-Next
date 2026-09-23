import type { Playlist, Track } from "@shared/types/player";
import { kugou as kgApi } from "@/apis/kugou";
import { kgSongsToTracks, type KGSong } from "@/utils/format/kugou";

interface KGPlaylistDetailResponse {
  code?: number;
  message?: string;
  id?: string | number;
  name?: string;
  description?: string;
  creator?: string;
  cover?: string;
  coverOriginal?: string;
  playCount?: number;
  total?: number;
  songs?: KGSong[];
}

/**
 * 获取KG歌单详情与歌曲列表
 * @param id - 歌单 ID (specialid)
 * @param fallbackName - 兜底名称
 * @returns 歌单元数据与 Track 列表
 */
export const fetchKugouPlaylist = async (
  id: string,
  fallbackName: string,
): Promise<{ playlist: Playlist; tracks: Track[] }> => {
  const body = await kgApi.playlist<KGPlaylistDetailResponse>({ id });
  if (body.code !== 200) throw new Error(body.message || `KG 歌单请求失败: ${body.code}`);

  const tracks = kgSongsToTracks(body.songs);

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
