/**
 * QS(汽水) 歌词匹配
 *
 * 两个入口：
 *  - getByPlatformId(id)  按 QS track_id 直取
 *  - getByQuery(track)    search → pickBestCandidate → 单次请求拿歌词
 *
 * 返回逐字原生文本（format: "qishui"），不做解析，交给渲染端。
 */

import { callQishui } from "@main/apis/qishui";
import { getCachedLyric, setCachedLyric } from "@main/database/lyricCache";
import { buildFingerprint, getMatchedId, setMatchedId } from "@main/database/lyricMatchCache";
import { coreLog } from "@main/utils/logger";
import type { LyricMatchResult } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { pickBestCandidate, type LyricCandidate } from "./utils";

/** 按 QS track_id 直取歌词 */
export const getByPlatformId = async (id: string): Promise<LyricMatchResult | null> => {
  const cached = getCachedLyric("qishui", id);
  if (cached) return cached;
  try {
    const body = await callQishui("lyric", { id });
    if (body.code !== 200) {
      coreLog.warn(
        `[lyric:qishui] getByPlatformId(${id}) code=${body.code}: ${body.message ?? "no message"}`,
      );
      return null;
    }
    const content = body.content?.trim();
    if (!content) return null;

    const result: LyricMatchResult = {
      platform: "qishui",
      format: "qishui",
      content,
    };
    setCachedLyric("qishui", id, result);
    return result;
  } catch (err) {
    coreLog.warn(`[lyric:qishui] getByPlatformId(${id}) failed:`, err);
    return null;
  }
};

/** 按 Track 元数据模糊搜索：search → 挑最佳 → 单次请求歌词 */
export const getByQuery = async (track: Track): Promise<LyricMatchResult | null> => {
  const fingerprint = buildFingerprint(track);
  const cached = getMatchedId(fingerprint, "qishui");
  if (cached) return getByPlatformId(cached.platformId);

  const keyword = `${track.title} ${track.artists[0]?.name ?? ""}`.trim();
  if (!keyword) return null;

  const candidates: LyricCandidate<{ id: string }>[] = [];
  try {
    const body = await callQishui("search", { keywords: keyword, limit: 25 });
    if (body.code !== 200) return null;
    for (const song of body.songs ?? []) {
      candidates.push({
        name: song.name,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        extra: { id: song.id },
      });
    }
  } catch (err) {
    coreLog.warn(`[lyric:qishui] search("${keyword}") failed:`, err);
    return null;
  }

  const best = pickBestCandidate(candidates, track);
  coreLog.info(
    `[lyric:qishui] fuzzy "${keyword}" → ${candidates.length} hits, best=${best?.name ?? "none"}`,
  );
  if (!best) return null;
  setMatchedId(fingerprint, "qishui", best.extra.id);
  return getByPlatformId(best.extra.id);
};
