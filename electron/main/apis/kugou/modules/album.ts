import { decodeName, fillCover } from "../core/config";
import { fetchAllPages } from "../core/pagination";
import { kgGatewayRequest } from "../core/request";
import { normalizeKGSong, type KGResourceSong } from "../core/song";
import type { KGModule } from "../core/types";

const PAGE_SIZE = 50;

interface RawAlbumDetail {
  album_id?: string | number;
  album_name?: string;
  publish_date?: string;
  sizable_cover?: string;
  intro?: string;
  author_name?: string;
  authors?: Array<{ author_id?: string | number; author_name?: string }>;
}

interface AlbumPageResponse {
  total?: number;
  data: { songs: KGResourceSong[]; total?: number } | KGResourceSong[];
}

/**
 * 将旧记录中的专辑名称解析为专辑 ID
 * @param idOrName - 专辑 ID 或名称
 * @returns 专辑 ID
 */
const resolveAlbumId = async (idOrName: string): Promise<string> => {
  if (/^[1-9]\d*$/.test(idOrName)) return idOrName;
  const response = await kgGatewayRequest<{
    data?: { lists?: Array<{ albumid?: string | number }> };
  }>("/v1/search/album", {
    params: {
      keyword: idOrName,
      page: 1,
      pagesize: 1,
      platform: "AndroidFilter",
      iscorrection: 1,
      nocollect: 0,
    },
    headers: { "x-router": "complexsearch.kugou.com" },
  });
  const id = response.data?.lists?.[0]?.albumid;
  if (!id) throw new Error("KG 专辑不存在或不可访问");
  return String(id);
};

/**
 * 从网关获取专辑详情及完整曲目，保留接口错误供界面提示
 * @param params - 专辑 ID 或旧记录中的名称
 * @returns 专辑详情与统一歌曲列表
 */
const album: KGModule = async (params) => {
  const rawId = String(params.id ?? params.album_id ?? "").trim();
  if (!rawId) return { code: 400, message: "id required" };
  const id = await resolveAlbumId(rawId);

  const [detailResponse, result] = await Promise.all([
    kgGatewayRequest<{ data: RawAlbumDetail[] }>("/kmr/v2/albums", {
      method: "POST",
      data: {
        data: [{ album_id: id }],
        fields: "album_id,album_name,publish_date,sizable_cover,intro,authors,author_name",
      },
      headers: { "x-router": "openapi.kugou.com", "kg-tid": "255" },
    }),
    fetchAllPages(async (page) => {
      const response = await kgGatewayRequest<AlbumPageResponse>("/v1/album_audio/lite", {
        method: "POST",
        data: { album_id: id, is_buy: "", page, pagesize: PAGE_SIZE },
        headers: { "x-router": "openapi.kugou.com", "kg-tid": "255" },
      });
      return Array.isArray(response.data)
        ? { items: response.data, total: response.total }
        : { items: response.data.songs, total: response.data.total ?? response.total };
    }, PAGE_SIZE),
  ]);

  const detail = detailResponse.data[0];
  if (!detail) throw new Error("KG 专辑不存在或不可访问");
  const songs = result.items.map((song) =>
    normalizeKGSong(song, {
      albumId: id,
      albumName: detail.album_name,
      cover: detail.sizable_cover,
    }),
  );

  return {
    code: 200,
    id,
    name: decodeName(detail.album_name),
    cover: fillCover(detail.sizable_cover, 300),
    coverOriginal: fillCover(detail.sizable_cover, 480),
    artist: decodeName(detail.author_name) || songs[0]?.artist || "",
    artists: detail.authors?.map((author) => ({
      id: author.author_id !== undefined ? String(author.author_id) : undefined,
      name: decodeName(author.author_name),
    })),
    publishTime: detail.publish_date,
    description: detail.intro,
    total: result.total,
    songs,
  };
};

export default album;
