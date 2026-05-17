import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type { UserSubcount } from "@/types/user";
import { netease as neteaseApi } from "@/apis/netease";
import { songsToTracks, toAlbum, toArtist, toPlaylist, toSubcount } from "@/utils/netease";
import { songsByIds } from "@/apis/song/netease";

const PAGE_SIZE = 50;

/** song_detail 单批上限，500 在 URL 长度与延迟之间比较折中 */
const SONG_DETAIL_BATCH = 500;

/**
 * 通用分页直到拉完
 * @param fetcher 第 N 页拉取函数（offset/limit），返回 `{ data, hasMore }`
 * @param extract 单项 raw → Item
 */
const fetchAllPages = async <Item>(
  fetcher: (offset: number, limit: number) => Promise<{ data?: any[]; hasMore?: boolean }>,
  extract: (raw: any) => Item,
): Promise<Item[]> => {
  const all: Item[] = [];
  let offset = 0;
  while (true) {
    const resp = await fetcher(offset, PAGE_SIZE);
    const list = resp.data ?? [];
    all.push(...list.map(extract));
    if (!resp.hasMore || list.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
};

/** fetchPlaylist 可选参数 */
export interface FetchPlaylistOptions {
  /** 元数据回调 */
  onMeta?: (meta: Playlist) => void;
  /** 曲目分批回调 */
  onBatch?: (batch: Track[]) => void;
  /** 中断信号 */
  signal?: AbortSignal;
}

/**
 * 拉取歌单：元数据 + 全部曲目
 *
 * 1) `playlist/detail` 一次返回 元数据 + 前 ~1000 首完整 song + 全量 trackIds
 * 2) 若 trackIds 还有未覆盖的，按 500 一批走 `song/detail` 补尾
 *
 * @param playlistId 歌单 id
 * @param options 元数据/曲目回调与中断信号
 */
export const fetchPlaylist = async (
  playlistId: string,
  options: FetchPlaylistOptions = {},
): Promise<void> => {
  if (options.signal?.aborted) return;
  const body = await neteaseApi.playlist_detail({ id: playlistId });
  if (options.signal?.aborted) return;
  const raw = body?.playlist;
  if (!raw) return;

  options.onMeta?.(toPlaylist(raw));

  const firstBatch = songsToTracks(raw.tracks);
  if (firstBatch.length > 0) options.onBatch?.(firstBatch);

  const have = new Set(firstBatch.map((t) => Number(t.id)));
  const missing: number[] = (raw.trackIds ?? [])
    .map((item: { id: number }) => item.id)
    .filter((tid: number) => !have.has(tid));

  for (let i = 0; i < missing.length; i += SONG_DETAIL_BATCH) {
    if (options.signal?.aborted) return;
    const chunk = missing.slice(i, i + SONG_DETAIL_BATCH);
    const batch = await songsByIds(chunk);
    if (options.signal?.aborted) return;
    if (batch.length > 0) options.onBatch?.(batch);
  }
};

/** 用户全部歌单 */
export const fetchUserPlaylists = async (uid: number, total?: number): Promise<Playlist[]> => {
  const body = await neteaseApi.user_playlist({
    uid,
    limit: total && total > 0 ? total : 1000,
    offset: 0,
  });
  return (body?.playlist ?? []).map(toPlaylist);
};

/** 用户订阅计数 */
export const fetchSubcount = async (): Promise<UserSubcount> => {
  const body = await neteaseApi.user_subcount();
  return toSubcount(body ?? {});
};

/** 用户喜欢歌曲 id 列表 */
export const fetchLikelist = async (uid: number): Promise<string[]> => {
  const body = await neteaseApi.likelist({ uid });
  return ((body?.ids as number[]) ?? []).map(String);
};

/** 用户收藏专辑 */
export const fetchUserAlbums = (): Promise<Album[]> =>
  fetchAllPages(async (offset, limit) => {
    const body = await neteaseApi.album_sublist({ limit, offset });
    return { data: body?.data, hasMore: body?.hasMore };
  }, toAlbum);

/** 用户收藏歌手 */
export const fetchUserArtists = (): Promise<Artist[]> =>
  fetchAllPages(async (offset, limit) => {
    const body = await neteaseApi.artist_sublist({ limit, offset });
    return { data: body?.data, hasMore: body?.hasMore };
  }, toArtist);

/** 切换红心 */
export const toggleLikeSong = async (trackId: string, like: boolean): Promise<boolean> => {
  const body = await neteaseApi.like({ id: trackId, like });
  return body?.code === 200;
};

/** 用户等级 */
export const fetchUserLevel = async (): Promise<number | undefined> => {
  const body = await neteaseApi.user_level();
  const level = body?.data?.level;
  return typeof level === "number" ? level : undefined;
};

/**
 * 拉取专辑：元数据 + 全部曲目
 * @param albumId 专辑 id
 */
export const fetchAlbum = async (
  albumId: string,
): Promise<{ album: Album; tracks: Track[]; description?: string } | null> => {
  const body = await neteaseApi.album({ id: albumId });
  const raw = body?.album;
  if (!raw) return null;
  return {
    album: toAlbum(raw),
    tracks: songsToTracks(body?.songs),
    description: typeof raw.description === "string" ? raw.description : undefined,
  };
};

/**
 * 拉取歌手：基本资料 + 热门 50 首 + 全部专辑
 * 两次并行请求（artists + artist_album），专辑用 200 的 limit 覆盖绝大多数情况
 * 更多歌曲通过 fetchArtistSongs 触底分页拉
 * @param artistId 歌手 id
 */
export const fetchArtist = async (
  artistId: string,
): Promise<{ artist: Artist; tracks: Track[]; albums: Album[] } | null> => {
  const [profile, albums] = await Promise.all([
    neteaseApi.artists({ id: artistId }),
    neteaseApi.artist_album({ id: artistId, limit: 200 }),
  ]);
  const rawArtist = profile?.artist;
  if (!rawArtist) return null;
  return {
    artist: toArtist(rawArtist),
    tracks: songsToTracks(profile?.hotSongs),
    albums: (albums?.hotAlbums ?? []).map(toAlbum),
  };
};

/**
 * 触底加载更多歌手歌曲
 * @param artistId 歌手 id
 * @param offset 偏移（首屏 50 首之后从 50 起）
 * @param limit 单页数量，默认 50
 */
export const fetchArtistSongs = async (
  artistId: string,
  offset: number,
  limit = 50,
): Promise<{ tracks: Track[]; more: boolean }> => {
  const body = await neteaseApi.artist_songs({ id: artistId, offset, limit, order: "hot" });
  return {
    tracks: songsToTracks(body?.songs),
    more: !!body?.more,
  };
};
