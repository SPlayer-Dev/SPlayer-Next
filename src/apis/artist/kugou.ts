import type { ArtistProfile } from "@/types/artist";
import { kugou as kgApi } from "@/apis/kugou";
import {
  kgAlbumToCoverItem,
  kgSongsToTracks,
  type KGAlbumItem,
  type KGArtistItem,
  type KGSong,
} from "@/utils/format/kugou";

interface KGArtistDetailResponse {
  code?: number;
  message?: string;
  artist?: KGArtistItem & { intro?: string; avatar?: string };
  songs?: KGSong[];
  albums?: KGAlbumItem[];
}

/**
 * 获取KG歌手详情、热门单曲与专辑
 * @param id - 歌手 ID
 * @param fallbackName - 兜底名称
 * @returns 歌手资料 profile
 */
export const fetchKugouArtist = async (
  id: string,
  fallbackName: string,
): Promise<ArtistProfile> => {
  const body = await kgApi.artist<KGArtistDetailResponse>({ id });
  if (body.code !== 200) throw new Error(body.message || `KG 歌手请求失败: ${body.code}`);

  const tracks = kgSongsToTracks(body.songs);
  const albums = (body.albums ?? []).map(kgAlbumToCoverItem);
  const artistId = String(body.artist?.id ?? id);

  return {
    id: artistId,
    name: body.artist?.name || fallbackName,
    avatar: body.artist?.avatar || body.artist?.cover,
    source: "kugou",
    tracks,
    albums,
    trackCount: body.artist?.songCount ?? tracks.length,
    albumCount: body.artist?.albumCount ?? albums.length,
  };
};
