import type { Playlist, Track } from "@shared/types/player";
import { bd as bdApi } from "@/apis/bd";
import type { BdPage, BdPlaylist, BdSong } from "@shared/types/bd";
import { bdSongsToTracks } from "@/utils/format/bd";

/**
 * 获取 BD 歌单详情与歌曲列表
 * @param id - 歌单 ID
 * @param fallbackName - 兜底名称
 * @param source - 歌单来源编号
 * @returns 歌单元数据与 Track 列表
 */
export const fetchBdPlaylist = async (
  id: string,
  fallbackName: string,
  source = 5,
): Promise<{ playlist: Playlist; tracks: Track[] }> => {
  const info = await bdApi.playlist<BdPlaylist>({ id, source });
  const songs = await bdApi.playlist_songs<BdPage<BdSong>>({
    id,
    source,
    page: 1,
    limit: 100,
  });
  const tracks = bdSongsToTracks(songs.items);

  return {
    playlist: {
      id: String(info.id ?? id),
      name: info.name || fallbackName,
      cover: info.pic || tracks[0]?.cover,
      description: info.description || info.info,
      owner: info.userName || info.userInfo?.nickname,
      trackCount: Number(info.musicCount ?? songs.total ?? tracks.length),
    },
    tracks,
  };
};
