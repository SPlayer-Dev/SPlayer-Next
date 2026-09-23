import type { Album, Track } from "@shared/types/player";
import { kugou as kgApi } from "@/apis/kugou";
import { kgSongsToTracks, type KGSong } from "@/utils/format/kugou";

interface KGAlbumDetailResponse {
  code?: number;
  message?: string;
  id?: string | number;
  name?: string;
  cover?: string;
  coverOriginal?: string;
  artist?: string;
  publishTime?: string;
  description?: string;
  total?: number;
  songs?: KGSong[];
}

/**
 * 获取KG专辑详情与歌曲列表
 * @param id - 专辑 ID
 * @param fallbackName - 兜底名称
 * @returns 专辑元数据与 Track 列表
 */
export const fetchKugouAlbum = async (
  id: string,
  fallbackName: string,
): Promise<{ album: Album; tracks: Track[]; description?: string }> => {
  const body = await kgApi.album<KGAlbumDetailResponse>({ id });
  if (body.code !== 200) throw new Error(body.message || `KG 专辑请求失败: ${body.code}`);

  const tracks = kgSongsToTracks(body.songs);
  const first = tracks[0];
  const yearNum = body.publishTime ? parseInt(body.publishTime.slice(0, 4), 10) : undefined;

  return {
    album: {
      id: String(body.id ?? id),
      name: body.name || first?.album?.name || fallbackName,
      cover: body.cover || first?.cover,
      artist: body.artist || first?.artists.map((a) => a.name).join(" / "),
      trackCount: body.total ?? tracks.length,
      year: Number.isFinite(yearNum) ? yearNum : undefined,
    },
    description: body.description,
    tracks,
  };
};
