import type { Track } from "@shared/types/player";
import type { NeteaseSong } from "@/types/netease";
import { netease as neteaseApi } from "@/apis/netease";
import { ensureOk, songsToTracks } from "@/utils/format/netease";

interface CloudItem {
  songId?: number;
  fileName?: string;
  fileSize?: number;
  simpleSong?: NeteaseSong;
}

interface UserCloudBody {
  code?: number;
  data?: CloudItem[];
  count?: number;
  size?: number;
  maxSize?: number;
  hasMore?: boolean;
}

export interface CloudPage {
  /** 本页转换后的曲目 */
  tracks: Track[];
  /** 云盘总曲目数 */
  count: number;
  /** 已用容量（字节） */
  size: number;
  /** 总容量（字节） */
  maxSize: number;
  /** 是否还有下一页 */
  hasMore: boolean;
}

/**
 * 拉取一页云盘数据
 * @param offset 偏移
 * @param limit 单页数量
 */
export const fetchUserCloud = async (offset: number, limit = 200): Promise<CloudPage> => {
  const body = (await neteaseApi.user_cloud({ offset, limit })) as UserCloudBody;
  ensureOk(body);
  const songs = (body.data ?? [])
    .map((item) => item.simpleSong)
    .filter((song): song is NeteaseSong => !!song);
  // 标记云盘
  const tracks = songsToTracks(songs).map((track) => ({ ...track, cloud: true }));
  return {
    tracks,
    count: body.count ?? 0,
    size: body.size ?? 0,
    maxSize: body.maxSize ?? 0,
    hasMore: body.hasMore ?? offset + songs.length < (body.count ?? 0),
  };
};

/**
 * 从云盘删除歌曲
 * @param ids 曲目 id 列表（字符串，会原样下发为数字数组）
 */
export const deleteCloudSongs = async (ids: string[]): Promise<void> => {
  if (ids.length === 0) return;
  ensureOk(await neteaseApi.user_cloud_del({ id: ids.map(Number) }));
};
