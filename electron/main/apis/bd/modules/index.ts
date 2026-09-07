import type { BdModule } from "../core/types";
import {
  album,
  albumSongs,
  artist,
  artistAlbums,
  artistSongs,
  playlist,
  playlistSongs,
  search,
} from "./catalog";
import { loginQrCheck, loginQrKey, userDetail } from "./login";
import { songUrl } from "./song_url";

export const modules: Record<string, BdModule> = {
  search,
  album,
  album_songs: albumSongs,
  artist,
  artist_albums: artistAlbums,
  artist_songs: artistSongs,
  playlist,
  playlist_songs: playlistSongs,
  login_qr_key: loginQrKey,
  login_qr_check: loginQrCheck,
  user_detail: userDetail,
  song_url: songUrl,
};
