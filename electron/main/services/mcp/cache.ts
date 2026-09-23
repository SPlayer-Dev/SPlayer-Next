import type { Track } from "@shared/types/player";
import { getTracksByIds as getDbTracksByIds } from "@main/database";

const MAX_CACHE_SIZE = 500;

/** MCP 进程内最近搜索/列出过的 Track 缓存池 */
const recentTracksCache = new Map<string, Track>();

/**
 * 将 Track 列表写入缓存池
 * @param tracks - 待缓存的 Track 数组
 */
export const cacheTracks = (tracks: Track[]): void => {
  for (const track of tracks) {
    if (track && typeof track.id === "string") {
      recentTracksCache.set(track.id, track);
    }
  }

  // 超过容量上限时淘汰最旧的条目
  if (recentTracksCache.size > MAX_CACHE_SIZE) {
    const keysToDelete = Array.from(recentTracksCache.keys()).slice(
      0,
      recentTracksCache.size - MAX_CACHE_SIZE,
    );
    for (const key of keysToDelete) {
      recentTracksCache.delete(key);
    }
  }
};

/**
 * 根据 track ID 列表获取 Track 对象（优先读取内存缓存池，未命中的回退至本地 SQLite 数据库）
 * @param ids - 目标 track ID 数组
 * @returns 查找到的 Track 数组
 */
export const getTracksByIds = (ids: string[]): Track[] => {
  if (ids.length === 0) return [];
  const foundMap = new Map<string, Track>();
  const missingIds: string[] = [];

  for (const id of ids) {
    const cached = recentTracksCache.get(id);
    if (cached) {
      foundMap.set(id, cached);
    } else {
      missingIds.push(id);
    }
  }

  if (missingIds.length > 0) {
    try {
      const dbTracks = getDbTracksByIds(missingIds);
      for (const track of dbTracks) {
        foundMap.set(track.id, track);
        recentTracksCache.set(track.id, track);
      }
    } catch {
      // 本地数据库未匹配或报错忽略
    }
  }

  const result: Track[] = [];
  for (const id of ids) {
    const item = foundMap.get(id);
    if (item) {
      result.push(item);
    }
  }
  return result;
};

/**
 * 根据单个 track ID 获取 Track 对象
 * @param id - 目标 track ID
 */
export const getTrackById = (id: string): Track | undefined => {
  const [track] = getTracksByIds([id]);
  return track;
};
