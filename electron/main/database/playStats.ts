/**
 * 播放统计采集
 */

import { getDb, isDbOpen } from "./index";
import { libraryLog } from "@main/utils/logger";
import type { Track } from "@shared/types/player";
import type {
  PlayEventInput,
  FavoriteEventInput,
  PlayStatsSummary,
  TopTrack,
  DailyPlayStats,
  HourlyPlayStats,
  TopAlbum,
  TopArtist,
} from "@shared/types/stats";

/** 写入一条播放记录 */
export const insertPlayEvent = (event: PlayEventInput): void => {
  if (!isDbOpen()) return;
  try {
    getDb()
      .prepare(
        `INSERT INTO play_history (track_id, source, started_at, listened_ms, track_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        event.track.id,
        event.track.source,
        event.startedAt,
        event.listenedMs,
        JSON.stringify(event.track),
      );
  } catch (error) {
    libraryLog.error("写入播放记录失败:", error);
  }
};

/** 写入一条收藏变更记录 */
export const insertFavoriteEvent = (event: FavoriteEventInput): void => {
  if (!isDbOpen()) return;
  try {
    getDb()
      .prepare(
        `INSERT INTO favorite_history (track_id, source, action, at, track_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        event.track.id,
        event.track.source,
        event.action,
        Date.now(),
        JSON.stringify(event.track),
      );
  } catch (error) {
    libraryLog.error("写入收藏记录失败:", error);
  }
};

/** 今日 00:00 的 unix ms（本地时区） */
const dayStartMs = (now: number): number => {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** 本周一 00:00 的 unix ms（本地时区） */
const weekStartMs = (now: number): number => {
  const date = new Date(now);
  const daysFromMonday = (date.getDay() + 6) % 7;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysFromMonday);
  return monday.getTime();
};

/** 本地日期 key：YYYY-MM-DD */
const dayKey = (date: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** 从倒序的有播放日期列表算连续天数 */
const computeStreak = (descDays: string[]): number => {
  if (descDays.length === 0) return 0;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (descDays[0] !== dayKey(today) && descDays[0] !== dayKey(yesterday)) return 0;
  const present = new Set(descDays);
  const cursor = new Date(today);
  // 今天还没听则从昨天起算
  if (descDays[0] !== dayKey(today)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (present.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
};

/** 读盘失败时的兜底空统计 */
const EMPTY_SUMMARY: PlayStatsSummary = {
  todayListenedMs: 0,
  weekListenedMs: 0,
  lastWeekListenedMs: 0,
  totalListenedMs: 0,
  weekPlayCount: 0,
  totalPlayCount: 0,
  weekFavoriteAdds: 0,
  streakDays: 0,
};

/**
 * 取播放统计汇总
 * 读盘失败时返回全 0
 */
export const getStatsSummary = (): PlayStatsSummary => {
  try {
    const db = getDb();
    const now = Date.now();
    const dayStart = dayStartMs(now);
    const weekStart = weekStartMs(now);
    const lastWeekStart = weekStart - 7 * 24 * 60 * 60 * 1000;

    /** 取单值聚合结果 */
    const scalar = (sql: string, ...params: number[]): number =>
      (db.prepare(sql).get(...params) as { value: number }).value;

    const listenedSince =
      "SELECT COALESCE(SUM(listened_ms), 0) AS value FROM play_history WHERE started_at >= ?";
    const playCountSince = "SELECT COUNT(*) AS value FROM play_history WHERE started_at >= ?";

    const dayRows = db
      .prepare(
        "SELECT DISTINCT date(started_at / 1000, 'unixepoch', 'localtime') AS day FROM play_history ORDER BY day DESC",
      )
      .all() as { day: string }[];

    return {
      todayListenedMs: scalar(listenedSince, dayStart),
      weekListenedMs: scalar(listenedSince, weekStart),
      lastWeekListenedMs: scalar(
        "SELECT COALESCE(SUM(listened_ms), 0) AS value FROM play_history WHERE started_at >= ? AND started_at < ?",
        lastWeekStart,
        weekStart,
      ),
      totalListenedMs: scalar(listenedSince, 0),
      weekPlayCount: scalar(playCountSince, weekStart),
      totalPlayCount: scalar(playCountSince, 0),
      weekFavoriteAdds: scalar(
        "SELECT COUNT(*) AS value FROM favorite_history WHERE action = 'add' AND at >= ?",
        weekStart,
      ),
      streakDays: computeStreak(dayRows.map((row) => row.day)),
    };
  } catch (error) {
    libraryLog.error("读取播放统计失败:", error);
    return EMPTY_SUMMARY;
  }
};

/** 取最常播放的曲目（含播放次数），按次数倒序；读盘失败返回空 */
export const getTopTracks = (limit: number): TopTrack[] => {
  try {
    const rows = getDb()
      .prepare(
        `SELECT track_json, COUNT(*) AS plays
         FROM play_history
         GROUP BY source, track_id
         ORDER BY plays DESC, MAX(started_at) DESC
         LIMIT ?`,
      )
      .all(limit) as { track_json: string; plays: number }[];
    return rows.map((row) => ({
      track: JSON.parse(row.track_json) as Track,
      playCount: row.plays,
    }));
  } catch (error) {
    libraryLog.error("读取最常播放失败:", error);
    return [];
  }
};

/**
 * 取最近 N 天（含今天）的每日播放统计
 * @param days - 最近 N 天（含今天）
 * @returns 每日播放统计数组
 */
export const getPlayHistoryDaily = (days: number): DailyPlayStats[] => {
  try {
    const startMs = dayStartMs(Date.now()) - (days - 1) * 24 * 60 * 60 * 1000;
    const rows = getDb()
      .prepare(
        `SELECT date(started_at / 1000, 'unixepoch', 'localtime') AS day,
                COUNT(*) AS playCount
         FROM play_history
         WHERE started_at >= ?
         GROUP BY day
         ORDER BY day ASC`,
      )
      .all(startMs) as { day: string; playCount: number }[];
    return rows.map((row) => ({ day: row.day, playCount: row.playCount }));
  } catch (error) {
    libraryLog.error("读取每日播放统计失败:", error);
    return [];
  }
};

/**
 * 取本地时区各小时的累计播放统计
 * @returns 0-23 点的播放次数
 */
export const getPlayHistoryHourly = (): HourlyPlayStats[] => {
  try {
    const rows = getDb()
      .prepare(
        `SELECT CAST(strftime('%H', started_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
                COUNT(*) AS playCount
         FROM play_history
         GROUP BY hour
         ORDER BY hour ASC`,
      )
      .all() as HourlyPlayStats[];
    const countByHour = new Map(rows.map((row) => [row.hour, row.playCount]));
    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      playCount: countByHour.get(hour) ?? 0,
    }));
  } catch (error) {
    libraryLog.error("读取分时播放统计失败:", error);
    return [];
  }
};

/**
 * 取最常播放的专辑（含播放次数）
 * @param limit - 取前 N 条
 */
export const getTopAlbums = (limit: number): TopAlbum[] => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT name, plays, track_json
         FROM (
           SELECT json_extract(track_json, '$.album.name') AS name,
                  COUNT(*) OVER (PARTITION BY json_extract(track_json, '$.album.name')) AS plays,
                  ROW_NUMBER() OVER (
                    PARTITION BY json_extract(track_json, '$.album.name')
                    ORDER BY started_at DESC
                  ) AS rn,
                  track_json
           FROM play_history
           WHERE json_extract(track_json, '$.album.name') IS NOT NULL
         )
         WHERE rn = 1
         ORDER BY plays DESC, name COLLATE NOCASE
         LIMIT ?`,
      )
      .all(limit) as { name: string; plays: number; track_json: string }[];
    const currentCover = db.prepare(
      `SELECT cover
       FROM tracks
       WHERE json_extract(album, '$.name') = ?
         AND cover IS NOT NULL
         AND TRIM(cover) != ''
       ORDER BY scanned_at DESC
       LIMIT 1`,
    );
    return rows.map((row) => {
      const track = JSON.parse(row.track_json) as Track;
      const libraryTrack = currentCover.get(row.name) as { cover: string } | undefined;
      return {
        name: row.name,
        artist: track.artists.map((artist) => artist.name).join(" / "),
        cover: libraryTrack?.cover || track.album?.cover || track.cover,
        playCount: row.plays,
      };
    });
  } catch (error) {
    libraryLog.error("读取最常播放专辑失败:", error);
    return [];
  }
};

/**
 * 取最常播放的歌手（含播放次数）
 * @param limit - 取前 N 条
 */
export const getTopArtists = (limit: number): TopArtist[] => {
  try {
    const rows = getDb()
      .prepare(
        `SELECT name, plays, track_json
         FROM (
           SELECT json_extract(a.value, '$.name') AS name,
                  COUNT(*) OVER (PARTITION BY json_extract(a.value, '$.name')) AS plays,
                  ROW_NUMBER() OVER (
                    PARTITION BY json_extract(a.value, '$.name')
                    ORDER BY started_at DESC
                  ) AS rn,
                  track_json
           FROM play_history, json_each(play_history.track_json, '$.artists') a
           WHERE json_extract(a.value, '$.name') IS NOT NULL
             AND TRIM(json_extract(a.value, '$.name')) != ''
         )
         WHERE rn = 1
         ORDER BY plays DESC, name COLLATE NOCASE
         LIMIT ?`,
      )
      .all(limit) as { name: string; plays: number; track_json: string }[];
    return rows.map((row) => {
      const track = JSON.parse(row.track_json) as Track;
      return {
        name: row.name,
        cover: track.cover,
        playCount: row.plays,
      };
    });
  } catch (error) {
    libraryLog.error("读取最常播放歌手失败:", error);
    return [];
  }
};
