import type { ArtistProfile } from "@/types/artist";
import { qqmusic as qmApi } from "@/apis/qqmusic";
import {
  qqAlbumCover,
  qqArtistCover,
  qqSongsToTracks,
  type QMAlbumItem,
  type QMSong,
} from "@/utils/format/qqmusic";

interface ArtistResponse {
  code?: number;
  message?: string;
  artist?: {
    mid?: string;
    name?: string;
    songCount?: number;
    albumCount?: number;
  };
  songs?: QMSong[];
  albums?: Array<QMAlbumItem & { publishTime?: string }>;
}

export const fetchQQMusicArtist = async (
  mid: string,
  fallbackName: string,
): Promise<ArtistProfile> => {
  const body = await qmApi.artist<ArtistResponse>({ mid });
  if (body.code !== 200) throw new Error(body.message || `QM 歌手请求失败: ${body.code}`);
  const tracks = qqSongsToTracks(body.songs);
  const albums = (body.albums ?? []).map((album) => ({
    id: album.id,
    title: album.name,
    cover: album.id ? qqAlbumCover(album.id) : undefined,
    subtitle: album.artist ?? "",
    trackCount: album.trackCount ?? 0,
  }));
  const artistMid = body.artist?.mid ?? mid;
  return {
    id: artistMid,
    name: body.artist?.name || fallbackName,
    avatar: qqArtistCover(artistMid),
    source: "qqmusic",
    tracks,
    albums,
    trackCount: body.artist?.songCount ?? tracks.length,
    albumCount: body.artist?.albumCount ?? albums.length,
  };
};
