import type { StreamingLibrarySnapshot, StreamingSearchResult } from "@shared/types/streaming";
import { deleteTracksByServer, getTracks, searchTracks } from "@main/database/streaming/tracks";
import { deleteAlbumsByServer, getAlbums } from "@main/database/streaming/albums";
import { deleteArtistsByServer, getArtists } from "@main/database/streaming/artists";
import { deletePlaylistsByServer, getPlaylists } from "@main/database/streaming/playlists";

/**
 * 删除指定服务器的全部流媒体数据
 * @param serverId - 服务器 ID
 */
export const deleteLibraryByServer = (serverId: string): void => {
  deletePlaylistsByServer(serverId);
  deleteTracksByServer(serverId);
  deleteAlbumsByServer(serverId);
  deleteArtistsByServer(serverId);
};

/**
 * 读取一个服务器当前已经写入 SQLite 的完整媒体快照
 * @param serverId - 服务器 ID
 * @returns 完整媒体库快照
 */
export const getLibrarySnapshot = (serverId: string): StreamingLibrarySnapshot => ({
  songs: getTracks(serverId),
  albums: getAlbums(serverId),
  artists: getArtists(serverId),
  playlists: getPlaylists(serverId),
});

/**
 * 在 SQLite 快照中搜索歌曲、专辑和歌手
 * @param serverId - 服务器 ID
 * @param query - 搜索词
 * @returns 聚合搜索结果
 */
export const searchLibrary = (serverId: string, query: string): StreamingSearchResult => {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return { songs: [], albums: [], artists: [] };
  return {
    songs: searchTracks(serverId, query),
    albums: getAlbums(serverId).filter(
      (album) =>
        album.name.toLocaleLowerCase().includes(needle) ||
        album.artist?.toLocaleLowerCase().includes(needle),
    ),
    artists: getArtists(serverId).filter((artist) =>
      artist.name.toLocaleLowerCase().includes(needle),
    ),
  };
};
