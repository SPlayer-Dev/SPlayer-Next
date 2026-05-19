import type { Album, Track } from "@shared/types/player";
import { netease as neteaseApi } from "@/apis/netease";
import { ensureOk, songsToTracks, toAlbum } from "@/utils/netease";

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
 * 收藏 / 取消收藏专辑
 * @param id 专辑 id
 * @param subscribe true 收藏 / false 取消
 */
export const subscribeAlbum = async (id: string, subscribe: boolean): Promise<void> => {
  ensureOk(await neteaseApi.album_sub({ id, t: subscribe ? 1 : 2 }));
};
