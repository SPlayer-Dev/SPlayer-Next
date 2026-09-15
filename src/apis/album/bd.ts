import type { Album, Track } from "@shared/types/player";
import { bd as bdApi } from "@/apis/bd";
import type { BdAlbum, BdPage, BdSong } from "@shared/types/bd";
import { bdSongsToTracks } from "@/utils/format/bd";

/**
 * 获取 BD 专辑详情与歌曲列表
 * @param id - 专辑 ID
 * @param fallbackName - 兜底名称
 * @returns 专辑元数据与 Track 列表
 */
export const fetchBdAlbum = async (
  id: string,
  fallbackName: string,
): Promise<{ album: Album; tracks: Track[]; description?: string }> => {
  const info = await bdApi.album<BdAlbum>({ id });
  const songs = await bdApi.album_songs<BdPage<BdSong>>({ id, page: 1, limit: 100 });
  const tracks = bdSongsToTracks(songs.items);
  const first = tracks[0];
  const releaseDate = info.showtime ?? info.releaseDate;
  const yearNum = releaseDate ? Number(releaseDate.slice(0, 4)) : undefined;

  return {
    album: {
      id: String(info.id ?? info.albumId ?? id),
      name: info.name || first?.album?.name || fallbackName,
      cover: info.pic || info.albumPic || info.albumPic120 || first?.cover,
      artist: info.artist || first?.artists.map((artist) => artist.name).join(" / "),
      trackCount: Number(info.musicCount ?? info.musicCnt ?? info.songNum ?? songs.total),
      year: yearNum !== undefined && Number.isFinite(yearNum) ? yearNum : undefined,
    },
    description: info.description || info.info,
    tracks,
  };
};
