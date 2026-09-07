import type { CoverItem } from "@/types/artist";
import type { BdAlbum, BdArtist, BdPlaylist, BdSong } from "@shared/types/bd";
import type { Track } from "@shared/types/player";
import { bdSongToTrack } from "@shared/utils/bd";

/**
 * 将 BD 歌曲列表转换为统一 Track 列表
 * @param songs - BD 歌曲数组
 * @returns Track 数组
 */
export const bdSongsToTracks = (songs: BdSong[] | undefined): Track[] =>
  (songs ?? []).map(bdSongToTrack);

/**
 * 将 BD 专辑转换为 CoverItem
 * @param album - BD 专辑
 * @returns CoverItem
 */
export const bdAlbumToCoverItem = (album: BdAlbum): CoverItem => ({
  id: String(album.id ?? album.albumId ?? ""),
  title: album.name,
  cover: album.pic || album.albumPic || album.albumPic120,
  subtitle: album.artist ?? "",
  trackCount: Number(album.musicCount ?? album.musicCnt ?? album.songNum ?? 0),
});

/**
 * 将 BD 歌手转换为 CoverItem
 * @param artist - BD 歌手
 * @returns CoverItem
 */
export const bdArtistToCoverItem = (artist: BdArtist): CoverItem => ({
  id: String(artist.id),
  title: artist.name,
  cover: artist.pic || artist.artistPic,
  subtitle: "",
  trackCount: Number(artist.musicCnt ?? 0),
});

/**
 * 将 BD 歌单转换为 CoverItem
 * @param playlist - BD 歌单
 * @returns CoverItem
 */
export const bdPlaylistToCoverItem = (playlist: BdPlaylist): CoverItem => ({
  id: String(playlist.id),
  title: playlist.name,
  cover: playlist.pic,
  subtitle: playlist.userName || playlist.userInfo?.nickname || "",
  trackCount: Number(playlist.musicCount ?? 0),
});
