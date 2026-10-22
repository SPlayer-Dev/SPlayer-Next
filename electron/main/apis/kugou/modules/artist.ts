import { decodeName, fillCover } from "../core/config";
import { signParamsKey } from "../core/crypto";
import { kgGatewayRequest } from "../core/request";
import { fetchAllPages } from "../core/pagination";
import { normalizeKGSong, type KGAudioInfo } from "../core/song";
import type { KGAlbumItem, KGArtistItem, KGSong } from "@shared/types/platform/kugou";
import type { KGModule } from "../core/types";

const PAGE_SIZE = 300;

interface RawArtistDetail {
  author_id?: number | string;
  author_name?: string;
  sizable_avatar?: string;
  album_count?: number;
  mv_count?: number;
  fansnums?: number;
  intro?: string;
  birthday?: string;
  long_intro?: Array<{ content?: string }>;
}

interface RawArtistAudio extends KGAudioInfo {
  audio_id?: number;
  album_audio_id?: number;
  audio_name?: string;
  album_id?: number | string;
  album_name?: string;
  author_name?: string;
  authors?: Array<{ author_id?: number | string; author_name?: string }>;
  trans_param?: {
    union_cover?: string;
    pay_block_tpl?: number;
  };
  pay_type?: number;
}

interface RawArtistAlbum {
  album_id?: number | string;
  album_name?: string;
  sizable_cover?: string;
  author_name?: string;
  publish_date?: string;
  song_count?: number;
  grade_count?: number;
}

/**
 * 将歌手列表的扁平歌曲适配为公共资源结构
 * @param raw - 歌手歌曲
 * @param currentArtistId - 当前歌手 ID
 * @returns 统一歌曲
 */
const normalizeArtistSong = (raw: RawArtistAudio, currentArtistId: string): KGSong =>
  normalizeKGSong({
    base: {
      audio_id: raw.audio_id,
      album_audio_id: raw.album_audio_id,
      audio_name: raw.audio_name,
      album_id: raw.album_id,
      author_name: raw.author_name,
    },
    audio_info: raw,
    authors: raw.authors?.length
      ? raw.authors
      : [{ author_id: currentArtistId, author_name: raw.author_name }],
    album_info: { album_name: raw.album_name },
    trans_param: raw.trans_param,
    deprecated: { pay_type: raw.pay_type },
  });

/**
 * 将歌手名称解析为接口所需的歌手 ID
 * @param idOrName - 歌手 ID 或名称
 * @returns 歌手 ID
 */
const resolveAuthorId = async (idOrName: string): Promise<string> => {
  if (/^\d+$/.test(idOrName)) return idOrName;
  const response = await kgGatewayRequest<{
    data?: { lists?: Array<{ AuthorId?: string | number }> };
  }>("/v1/search/author", {
    params: {
      keyword: idOrName,
      page: 1,
      pagesize: 1,
      platform: "AndroidFilter",
      iscorrection: 1,
    },
    headers: { "x-router": "complexsearch.kugou.com" },
  });
  const id = response.data?.lists?.[0]?.AuthorId;
  if (!id) throw new Error("KG 歌手不存在或不可访问");
  return String(id);
};

/**
 * 获取歌手资料及完整歌曲和专辑
 * @param params - 歌手 ID 或名称
 * @returns 歌手详情与全量列表
 */
const artist: KGModule = async (params) => {
  const rawId = String(params.id ?? params.author_id ?? params.artist_id ?? "").trim();
  if (!rawId) return { code: 400, message: "id required" };

  const id = await resolveAuthorId(rawId);
  const clienttime = Math.floor(Date.now() / 1000);

  const [detailRes, songsRes, albumsRes] = await Promise.all([
    kgGatewayRequest<{ data?: RawArtistDetail }>("/kmr/v3/author", {
      method: "POST",
      data: { author_id: id },
      headers: { "x-router": "openapi.kugou.com", "kg-tid": "36" },
    }),
    fetchAllPages(async (page) => {
      const response = await kgGatewayRequest<{ data: RawArtistAudio[]; total?: number }>(
        "/kmr/v1/audio_group/author",
        {
          method: "POST",
          baseURL: "https://openapi.kugou.com",
          data: {
            author_id: id,
            pagesize: PAGE_SIZE,
            page,
            sort: 1,
            area_code: "all",
            clienttime,
            key: signParamsKey(clienttime),
          },
          headers: { "x-router": "openapi.kugou.com", "kg-tid": "220" },
        },
      );
      return {
        items: response.data.map((song) => normalizeArtistSong(song, id)),
        total: response.total,
      };
    }, PAGE_SIZE),
    fetchAllPages(async (page) => {
      const response = await kgGatewayRequest<{ data: RawArtistAlbum[]; total?: number }>(
        "/kmr/v1/author/albums",
        {
          method: "POST",
          data: {
            author_id: id,
            pagesize: PAGE_SIZE,
            page,
            sort: 3,
            category: 1,
            area_code: "all",
          },
          headers: { "x-router": "openapi.kugou.com", "kg-tid": "36" },
        },
      );
      return { items: response.data, total: response.total };
    }, PAGE_SIZE),
  ]);

  const detail = detailRes.data ?? {};
  const songs = songsRes.items;
  const rawAlbums = albumsRes.items;

  const avatar = fillCover(detail.sizable_avatar, 300);
  const albums: KGAlbumItem[] = rawAlbums.map((a) => ({
    id: String(a.album_id ?? ""),
    name: decodeName(a.album_name || ""),
    cover: fillCover(a.sizable_cover, 300),
    artist: decodeName(a.author_name || detail.author_name || ""),
    artistId: id,
    trackCount: a.song_count ?? 0,
    publishTime: a.publish_date,
  }));

  const introText =
    detail.intro ||
    (detail.long_intro &&
      detail.long_intro
        .map((item) => item.content)
        .filter(Boolean)
        .join("\n\n"));

  const artistInfo: KGArtistItem & { intro?: string; avatar?: string } = {
    id: String(detail.author_id || id),
    name: decodeName(detail.author_name || rawId),
    cover: avatar,
    avatar,
    songCount: songsRes.total,
    albumCount: albumsRes.total,
    fansCount: detail.fansnums,
    intro: introText,
  };

  return {
    code: 200,
    artist: artistInfo,
    songs,
    albums,
  };
};

export default artist;
