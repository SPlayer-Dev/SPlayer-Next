/**
 * Kugou 歌词匹配
 *
 * 两个入口：
 *  - getByPlatformId(hash) 按 hash 直取（kugou 的主键是 hash，不是数字 id；
 *                          单 hash 无 name/duration，服务端命中率低，建议走 getByQuery）
 *  - getByQuery(track)     search → pickBestCandidate → 单次请求拿歌词
 *
 * 返回只带原生格式文本（krc / lrc + 翻译 / 罗马音），不做解析，交给渲染端。
 */

import { callKugou } from "@main/apis/kugou";
import { getCachedLyric, setCachedLyric } from "@main/database/lyricCache";
import { buildFingerprint, getMatchedId, setMatchedId } from "@main/database/lyricMatchCache";
import { coreLog } from "@main/utils/logger";
import type { LyricMatchResult } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { pickBestCandidate, type LyricCandidate } from "./utils";

/** krc 优先，其次 lrc */
const pickFormatted = (
  krc?: string,
  lrc?: string,
): { content: string; format: "krc" | "lrc" } | undefined => {
  const krcContent = krc?.trim();
  if (krcContent) return { content: krcContent, format: "krc" };
  const lrcContent = lrc?.trim();
  if (lrcContent) return { content: lrcContent, format: "lrc" };
  return undefined;
};

/**
 * Kugou lyric 接口强依赖 hash + name + duration 三者：
 * 只有 hash 时服务端 candidates 基本为空，必须把 name/duration 一并传过去。
 */
const fetchLyric = async (args: {
  hash: string;
  name?: string;
  /** 毫秒 */
  durationMs?: number;
}): Promise<LyricMatchResult | null> => {
  const cached = getCachedLyric("kugou", args.hash);
  if (cached) return cached;
  try {
    const body = await callKugou("lyric", {
      hash: args.hash,
      name: args.name ?? "",
      duration: args.durationMs ? Math.round(args.durationMs / 1000) : 0,
    });
    if (body.code !== 200) {
      coreLog.warn(
        `[lyric:kugou] fetchLyric(${args.hash}) code=${body.code}: ${body.message ?? "no message"}`,
      );
      return null;
    }

    const main = pickFormatted(body.krc, body.lrc);
    if (!main) return null;

    const trans = body.trans?.trim();
    const roma = body.roma?.trim();

    const result: LyricMatchResult = {
      platform: "kugou",
      format: main.format,
      content: main.content,
      translation: trans || undefined,
      translationFormat: trans ? "lrc" : undefined,
      romaji: roma || undefined,
      romajiFormat: roma ? "lrc" : undefined,
    };
    setCachedLyric("kugou", args.hash, result);
    return result;
  } catch (err) {
    coreLog.warn(`[lyric:kugou] fetchLyric(${args.hash}) failed:`, err);
    return null;
  }
};

/** 按 Kugou hash 直取（只有 hash 时用；精度受限） */
export const getByPlatformId = (hash: string): Promise<LyricMatchResult | null> =>
  fetchLyric({ hash });

/** 按 Track 元数据模糊搜索：search → 挑最佳 → 单次请求歌词 */
export const getByQuery = async (track: Track): Promise<LyricMatchResult | null> => {
  const fingerprint = buildFingerprint(track);
  const cached = getMatchedId(fingerprint, "kugou");
  if (cached) {
    return fetchLyric({
      hash: cached.platformId,
      name: track.title,
      durationMs: track.duration,
    });
  }

  const keyword = `${track.title} ${track.artists[0]?.name ?? ""}`.trim();
  if (!keyword) return null;

  const candidates: LyricCandidate<{ hash: string }>[] = [];
  try {
    const body = await callKugou("search", { keywords: keyword, limit: 25 });
    if (body.code !== 200) return null;
    for (const song of body.songs ?? []) {
      candidates.push({
        name: song.name,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        extra: { hash: song.hash },
      });
    }
  } catch (err) {
    coreLog.warn(`[lyric:kugou] search("${keyword}") failed:`, err);
    return null;
  }

  const best = pickBestCandidate(candidates, track);
  coreLog.info(
    `[lyric:kugou] fuzzy "${keyword}" → ${candidates.length} hits, best=${best?.name ?? "none"}`,
  );
  if (!best) return null;
  setMatchedId(fingerprint, "kugou", best.extra.hash);
  return fetchLyric({
    hash: best.extra.hash,
    name: best.name,
    durationMs: best.duration,
  });
};
