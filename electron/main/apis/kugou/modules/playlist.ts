/**
 * KG 歌单详情与歌曲列表
 *
 * 接口：
 * - 歌单信息：GET http://mobilecdn.kugou.com/api/v3/special/info
 * - 歌单歌曲：GET http://mobilecdn.kugou.com/api/v3/special/song
 */

import { decodeName, fillCover } from "../core/config";
import { kgRequest } from "../core/request";
import type { KGModule, KGSong, Quality } from "../core/types";

interface RawSpecialInfo {
  specialid?: number | string;
  specialname?: string;
  nickname?: string;
  suid?: number | string;
  imgurl?: string;
  intro?: string;
  playcount?: number;
  songcount?: number;
  collectcount?: number;
  publishtime?: string;
}

interface RawSpecialSong {
  hash?: string;
  audio_id?: number;
  album_audio_id?: number;
  songname?: string;
  filename?: string;
  singername?: string;
  album_id?: string | number;
  album_name?: string;
  duration?: number;
  filesize?: number;
  "320hash"?: string;
  "320filesize"?: number;
  sqhash?: string;
  sqfilesize?: number;
  hires_hash?: string;
  hires_filesize?: number;
  reshash?: string;
  resfilesize?: number;
  pay_type?: number;
  trans_param?: {
    union_cover?: string;
    pay_block_tpl?: number;
  };
}

const formatArtist = (filename: string, singername?: string): string => {
  if (singername) {
    return decodeName(singername)
      .split(/、|,|;|\//)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" / ");
  }
  const parts = filename.split(" - ");
  if (parts.length > 1) {
    return decodeName(parts[0].trim());
  }
  return "";
};

const formatSongName = (filename: string, songname?: string): string => {
  if (songname) return decodeName(songname);
  const parts = filename.split(" - ");
  if (parts.length > 1) {
    return decodeName(parts.slice(1).join(" - ").trim());
  }
  return decodeName(filename);
};

const normalizeSpecialSong = (raw: RawSpecialSong, fallbackCover?: string): KGSong => {
  const trans = raw.trans_param ?? {};
  const cover = fillCover(trans.union_cover || fallbackCover, 300);
  const coverOriginal = fillCover(trans.union_cover || fallbackCover, 480);
  const interval = raw.duration ?? 0;

  const sizes: Partial<Record<Quality, number>> = {};
  const hashes: Partial<Record<Quality, string>> = {};

  if (raw.filesize && raw.hash) {
    sizes["128k"] = raw.filesize;
    hashes["128k"] = raw.hash;
  }
  if (raw["320filesize"] && raw["320hash"]) {
    sizes["320k"] = raw["320filesize"];
    hashes["320k"] = raw["320hash"];
  }
  if (raw.sqfilesize && raw.sqhash) {
    sizes.flac = raw.sqfilesize;
    hashes.flac = raw.sqhash;
  }
  const hrSize = raw.hires_filesize ?? raw.resfilesize;
  const hrHash = raw.hires_hash ?? raw.reshash;
  if (hrSize && hrHash) {
    sizes.flac24bit = hrSize;
    hashes.flac24bit = hrHash;
  }

  const filename = raw.filename || "";
  const artistName = formatArtist(filename, raw.singername);
  const artists = artistName ? artistName.split(" / ").map((name) => ({ id: name, name })) : [];

  return {
    id: String(raw.audio_id || raw.hash || ""),
    audioId: raw.audio_id ?? 0,
    albumAudioId: raw.album_audio_id,
    hash: raw.hash ?? "",
    name: formatSongName(filename, raw.songname),
    artist: artistName,
    artists,
    album: decodeName(raw.album_name ?? ""),
    albumId: raw.album_id ?? "",
    cover,
    coverOriginal,
    interval,
    duration: interval * 1000,
    qualities: Object.keys(hashes) as Quality[],
    hashes,
    sizes,
    pay: {
      payplay: raw.pay_type ?? 0,
    },
  };
};

const playlist: KGModule = async (params) => {
  const id = String(params.id ?? params.specialid ?? params.special_id ?? "");
  if (!id) return { code: 400, message: "id required" };

  const [infoRes, songsRes] = await Promise.all([
    kgRequest<{ data?: RawSpecialInfo }>(
      `http://mobilecdn.kugou.com/api/v3/special/info?specialid=${encodeURIComponent(id)}&format=json`,
    ),
    kgRequest<{ data?: { info?: RawSpecialSong[]; total?: number } }>(
      `http://mobilecdn.kugou.com/api/v3/special/song?specialid=${encodeURIComponent(id)}&page=1&pagesize=300&format=json`,
    ),
  ]);

  const info = infoRes.data ?? {};
  const rawSongs = songsRes.data?.info ?? [];

  const cover = fillCover(info.imgurl, 300);
  const coverOriginal = fillCover(info.imgurl, 480);
  const songs = rawSongs.map((s) => normalizeSpecialSong(s, info.imgurl));

  return {
    code: 200,
    id: String(info.specialid || id),
    name: decodeName(info.specialname || ""),
    description: info.intro,
    creator: decodeName(info.nickname || ""),
    cover,
    coverOriginal,
    playCount: info.playcount ?? 0,
    total: info.songcount ?? songsRes.data?.total ?? songs.length,
    songs,
  };
};

export default playlist;
