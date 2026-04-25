/**
 * QQMusic 歌词匹配
 *
 * 两个入口：
 *  - getByPlatformId(id)    按 QQMusic song id 直取
 *  - getByQuery(track)      search → pickBestCandidate → 单次请求拿歌词
 *
 * 返回只带原生格式文本（qrc / lrc + 翻译 / 罗马音），不做解析，交给渲染端。
 */

import { callQQMusic } from "@main/apis/qqmusic";
import { getCachedLyric, setCachedLyric } from "@main/database/lyricCache";
import { buildFingerprint, getMatchedId, setMatchedId } from "@main/database/lyricMatchCache";
import { coreLog } from "@main/utils/logger";
import type { LyricMatchResult } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { pickBestCandidate, type LyricCandidate } from "./utils";

/** qrc 优先，其次 lrc */
const pickFormatted = (
  qrc?: string,
  lrc?: string,
): { content: string; format: "qrc" | "lrc" } | undefined => {
  const qrcContent = qrc?.trim();
  if (qrcContent) return { content: qrcContent, format: "qrc" };
  const lrcContent = lrc?.trim();
  if (lrcContent) return { content: lrcContent, format: "lrc" };
  return undefined;
};

/**
 * 按 QQMusic song id 直取歌词
 * @param id  数字 id（QM 歌词接口必需）
 * @param mid 字符串 mid（用于 AMLL TTML DB 等外部映射；可选）
 */
export const getByPlatformId = async (
  id: string,
  mid?: string,
): Promise<LyricMatchResult | null> => {
  const cached = getCachedLyric("qqmusic", id);
  if (cached) return cached;
  try {
    const body = await callQQMusic("lyric", { id });
    if (body.code !== 200) {
      coreLog.warn(
        `[lyric:qqmusic] getByPlatformId(${id}) code=${body.code}: ${body.message ?? "no message"}`,
      );
      return null;
    }

    const main = pickFormatted(body.qrc, body.lrc);
    if (!main) return null;

    const trans = body.trans?.trim();
    const roma = body.roma?.trim();

    const result: LyricMatchResult = {
      platform: "qqmusic",
      format: main.format,
      content: main.content,
      translation: trans || undefined,
      translationFormat: trans ? "lrc" : undefined,
      romaji: roma || undefined,
      romajiFormat: roma ? main.format : undefined,
      extra: mid ? { mid } : undefined,
    };
    setCachedLyric("qqmusic", id, result);
    return result;
  } catch (err) {
    coreLog.warn(`[lyric:qqmusic] getByPlatformId(${id}) failed:`, err);
    return null;
  }
};

/** 按 Track 元数据模糊搜索：search → 挑最佳 → 单次请求歌词 */
export const getByQuery = async (track: Track): Promise<LyricMatchResult | null> => {
  const fingerprint = buildFingerprint(track);
  const cached = getMatchedId(fingerprint, "qqmusic");
  if (cached) return getByPlatformId(cached.platformId, cached.extra?.mid);

  const keyword = `${track.title} ${track.artists[0]?.name ?? ""}`.trim();
  if (!keyword) return null;

  const candidates: LyricCandidate<{ id: string; mid: string }>[] = [];
  try {
    const body = await callQQMusic("search", { keywords: keyword, limit: 25 });
    if (body.code !== 200) return null;
    for (const song of body.songs ?? []) {
      candidates.push({
        name: song.name,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        extra: { id: song.id, mid: song.mid },
      });
    }
  } catch (err) {
    coreLog.warn(`[lyric:qqmusic] search("${keyword}") failed:`, err);
    return null;
  }

  const best = pickBestCandidate(candidates, track);
  coreLog.info(
    `[lyric:qqmusic] fuzzy "${keyword}" → ${candidates.length} hits, best=${best?.name ?? "none"}`,
  );
  if (!best) return null;
  setMatchedId(fingerprint, "qqmusic", best.extra.id, { mid: best.extra.mid });
  return getByPlatformId(best.extra.id, best.extra.mid);
};
