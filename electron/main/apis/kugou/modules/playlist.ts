import { decodeName, fillCover } from "../core/config";
import { fetchAllPages } from "../core/pagination";
import { kgGatewayRequest, kgRequest } from "../core/request";
import { normalizeKGSong } from "../core/song";
import type { KGSong } from "@shared/types/platform/kugou";
import type { KGModule } from "../core/types";

const PAGE_SIZE = 300;

interface RawPlaylistInfo {
  name?: string;
  intro?: string;
  pic?: string;
  list_create_username?: string;
}

interface RawPlaylistSong {
  hash: string;
  audio_id?: number;
  mixsongid?: number;
  name?: string;
  album_id?: string | number;
  albuminfo?: { id?: number; name?: string };
  singerinfo?: Array<{ id?: number; name?: string }>;
  cover?: string;
  size?: number;
  timelen?: number;
  feetype?: number;
  privilege?: number;
  download?: Array<{ hash?: string; pay_type?: number }>;
  relate_goods?: Array<{ level?: number; hash?: string; size?: number }>;
}

interface PlaylistPageResponse {
  data: {
    count: number;
    list_info: RawPlaylistInfo;
    songs: RawPlaylistSong[];
  };
}

/**
 * 将新版歌单的结构化元数据适配为公共歌曲结构
 * @param raw - 歌单歌曲
 * @returns 包含专辑和歌手身份的歌曲
 */
const normalizePlaylistSong = (raw: RawPlaylistSong): KGSong => {
  const variants = new Map(raw.relate_goods?.map((variant) => [variant.level, variant]));
  const name = raw.name || "";
  const separator = name.indexOf(" - ");
  return normalizeKGSong({
    base: {
      audio_id: raw.audio_id,
      album_audio_id: raw.mixsongid,
      album_id: raw.albuminfo?.id || raw.album_id,
      audio_name: separator >= 0 ? name.slice(separator + 3) : name,
      author_name: separator >= 0 ? name.slice(0, separator) : undefined,
    },
    audio_info: {
      hash: raw.hash,
      filesize: raw.size,
      duration: raw.timelen,
      hash_320: variants.get(4)?.hash,
      filesize_320: variants.get(4)?.size,
      hash_flac: variants.get(5)?.hash,
      filesize_flac: variants.get(5)?.size,
      hash_high: variants.get(6)?.hash,
      filesize_high: variants.get(6)?.size,
    },
    authors: raw.singerinfo?.map((singer) => ({
      author_id: singer.id,
      author_name: singer.name,
    })),
    album_info: { album_name: raw.albuminfo?.name, cover: raw.cover },
    copyright: { privilege: raw.privilege },
    deprecated: {
      pay_type: raw.download?.find((item) => item.hash === raw.hash)?.pay_type,
      feetype: raw.feetype,
    },
  });
};

/**
 * 获取新版公开歌单及其完整歌曲，兼容旧版数字歌单 ID
 * @param params - 歌单 ID
 * @returns 歌单详情与完整的结构化歌曲列表
 */
const playlist: KGModule = async (params) => {
  const id = String(params.id ?? params.specialid ?? params.special_id ?? "").trim();
  if (!id) return { code: 400, message: "id required" };

  let globalId = id;
  if (/^\d+$/.test(id)) {
    const response = await kgRequest<{ data: { global_specialid: string } }>(
      `http://mobilecdn.kugou.com/api/v3/special/info?specialid=${id}&format=json`,
    );
    globalId = response.data.global_specialid;
    if (!globalId) throw new Error("KG 歌单不存在或不可访问");
  }

  let info: RawPlaylistInfo | undefined;
  const { items: songs, total } = await fetchAllPages(async (page) => {
    const response = await kgGatewayRequest<PlaylistPageResponse>(
      "/pubsongs/v2/get_other_list_file_nofilt",
      {
        params: {
          global_collection_id: globalId,
          begin_idx: (page - 1) * PAGE_SIZE,
          pagesize: PAGE_SIZE,
          area_code: 1,
          plat: 1,
          type: 1,
          mode: 1,
          personal_switch: 1,
        },
      },
    );
    if (page === 1) info = response.data.list_info;
    return { items: response.data.songs.map(normalizePlaylistSong), total: response.data.count };
  }, PAGE_SIZE);

  return {
    code: 200,
    id: globalId,
    name: decodeName(info?.name),
    description: info?.intro,
    creator: decodeName(info?.list_create_username),
    cover: fillCover(info?.pic, 300),
    coverOriginal: fillCover(info?.pic, 480),
    total,
    songs,
  };
};

export default playlist;
