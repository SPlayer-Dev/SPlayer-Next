import type { BdAlbum, BdArtist, BdPage, BdPlaylist, BdSong } from "../../../../../shared/types/bd";
import type { BdModule, BdParams } from "../core/types";

interface RawPage<T> {
  resultList?: T[];
  list?: T[];
  musicList?: T[];
  total?: number | string;
}

const pagination = (params: BdParams, zeroBased = false) => {
  const firstPage = zeroBased ? 0 : 1;
  const page = Math.max(firstPage, Math.floor(Number(params.page) || firstPage));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(params.limit) || 50)));
  return { page, limit, offset: (page - firstPage) * limit };
};

export const normalizeBdPage = <T>(
  data: RawPage<T> | null,
  offset: number,
  limit: number,
): BdPage<T> => {
  const items = data?.resultList ?? data?.list ?? data?.musicList ?? [];
  const knownTotal = data?.total == null ? undefined : Number(data.total);
  const total =
    knownTotal !== undefined && Number.isFinite(knownTotal)
      ? knownTotal
      : offset + items.length + (items.length === limit ? 1 : 0);
  return { items, total, hasMore: items.length > 0 && offset + items.length < total };
};

export const search: BdModule = async (params, context) => {
  const kinds = { songs: "music", artists: "artist", playlists: "playlist" };
  const category = String(params.type ?? "songs");
  if (!Object.hasOwn(kinds, category)) throw new Error(`BD 不支持此搜索分类: ${category}`);
  const keyword = String(params.keywords ?? "").trim();
  if (!keyword) return { items: [], total: 0, hasMore: false };
  const { page, limit, offset } = pagination(params, true);
  const kind = kinds[category as keyof typeof kinds];
  const data = await context.request<RawPage<BdSong | BdArtist | BdPlaylist>>(
    `/api/search/${kind}/list`,
    { params: { keyword, correct: "1", pn: page, rn: limit } },
  );
  return normalizeBdPage(data, offset, limit);
};

export const artist: BdModule = (params, context) =>
  context.request<BdArtist>(`/api/service/artist/${encodeURIComponent(String(params.id))}`);

export const artistSongs: BdModule = async (params, context) => {
  const { page, limit, offset } = pagination(params);
  const id = String(params.id);
  const data = await context.request<RawPage<BdSong>>(
    `/api/service/artist/music/${encodeURIComponent(id)}`,
    { params: { artistId: id, pn: page, rn: limit } },
  );
  return normalizeBdPage(data, offset, limit);
};

export const artistAlbums: BdModule = async (params, context) => {
  const { page, limit, offset } = pagination(params);
  const data = await context.request<RawPage<BdAlbum>>(
    `/api/service/artist/album/${encodeURIComponent(String(params.id))}`,
    { params: { pn: page, rn: limit } },
  );
  return normalizeBdPage(data, offset, limit);
};

export const album: BdModule = (params, context) =>
  context.request<BdAlbum>(`/api/service/album/${encodeURIComponent(String(params.id))}`);

export const albumSongs: BdModule = async (params, context) => {
  const { page, limit, offset } = pagination(params);
  const data = await context.request<RawPage<BdSong>>(
    `/api/service/album/music/${encodeURIComponent(String(params.id))}`,
    { params: { pn: page, rn: limit } },
  );
  return normalizeBdPage(data, offset, limit);
};

export const playlist: BdModule = (params, context) =>
  context.request<BdPlaylist>(
    `/api/service/playlist/info/${encodeURIComponent(String(params.id))}`,
    {
      params: { source: Number(params.source) || 5 },
    },
  );

export const playlistSongs: BdModule = async (params, context) => {
  const { page, limit, offset } = pagination(params);
  const data = await context.request<RawPage<BdSong>>(
    `/api/service/playlist/${encodeURIComponent(String(params.id))}/musicList`,
    { params: { source: Number(params.source) || 5, pn: page, rn: limit } },
  );
  return normalizeBdPage(data, offset, limit);
};
