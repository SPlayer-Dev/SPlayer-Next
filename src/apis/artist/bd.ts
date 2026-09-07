import type { Track } from "@shared/types/player";
import type { ArtistProfile } from "@/types/artist";
import { bd as bdApi } from "@/apis/bd";
import type { BdAlbum, BdArtist, BdPage, BdSong } from "@shared/types/bd";
import { bdAlbumToCoverItem, bdSongsToTracks } from "@/utils/format/bd";

/**
 * 获取 BD 歌手详情、热门单曲与专辑
 * @param id - 歌手 ID
 * @param fallbackName - 兜底名称
 * @returns 歌手资料 profile
 */
export const fetchBdArtist = async (id: string, fallbackName: string): Promise<ArtistProfile> => {
  const info = await bdApi.artist<BdArtist>({ id });
  const [songs, albums] = await Promise.all([
    bdApi.artist_songs<BdPage<BdSong>>({ id, page: 1, limit: 50 }),
    bdApi.artist_albums<BdPage<BdAlbum>>({ id, page: 1, limit: 50 }),
  ]);
  const tracks = bdSongsToTracks(songs.items);
  const coverItems = albums.items.map(bdAlbumToCoverItem);

  return {
    id: String(id),
    name: info.name || fallbackName,
    avatar: info.pic || info.artistPic,
    source: "bd",
    tracks,
    albums: coverItems,
    trackCount: Number(info.musicCnt ?? songs.total ?? tracks.length),
    albumCount: Number(info.albumCnt ?? albums.total ?? coverItems.length),
  };
};

/**
 * 触底加载更多 BD 歌手歌曲
 * @param id - 歌手 ID
 * @param offset - 已加载歌曲数
 * @param limit - 单页数量
 * @returns 新一页歌曲与是否还有更多
 */
export const fetchBdArtistSongs = async (
  id: string,
  offset: number,
  limit = 50,
): Promise<{ tracks: Track[]; more: boolean }> => {
  const body = await bdApi.artist_songs<BdPage<BdSong>>({
    id,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  return {
    tracks: bdSongsToTracks(body.items),
    more: body.hasMore,
  };
};
