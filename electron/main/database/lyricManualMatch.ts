/**
 * 用户手动选择的歌词
 *
 * 用户的明确选择不是缓存，不过期，也不随清理缓存或内容校验失败而删除
 */

import type { LyricManualMatch, LyricMatchSource } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { getDb } from "./index";
import { buildTrackIdentity } from "./lyricMatchCache";

/**
 * 读取歌曲的手动选择
 * @param track - 歌曲信息
 * @returns 手动选择，不存在时为 null
 */
export const getManualMatch = (track: Track): LyricManualMatch | null => {
  const row = getDb()
    .prepare(
      "SELECT platform, platform_id, name, artist, duration FROM lyric_manual_match WHERE track_key = ?",
    )
    .get(buildTrackIdentity(track)) as
    | {
        platform: LyricMatchSource;
        platform_id: string;
        name: string;
        artist: string;
        duration: number | null;
      }
    | undefined;
  if (!row) return null;
  return {
    platform: row.platform,
    id: row.platform_id,
    name: row.name,
    artist: row.artist,
    duration: row.duration ?? undefined,
  };
};

/**
 * 保存歌曲的手动选择，重复选择时覆盖
 * @param track - 歌曲信息
 * @param match - 手动选择
 */
export const setManualMatch = (track: Track, match: LyricManualMatch): void => {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO lyric_manual_match
         (track_key, platform, platform_id, name, artist, duration, picked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      buildTrackIdentity(track),
      match.platform,
      match.id,
      match.name,
      match.artist,
      match.duration ?? null,
      Date.now(),
    );
};

/**
 * 清除歌曲的手动选择
 * @param track - 歌曲信息
 */
export const clearManualMatch = (track: Track): void => {
  getDb()
    .prepare("DELETE FROM lyric_manual_match WHERE track_key = ?")
    .run(buildTrackIdentity(track));
};
