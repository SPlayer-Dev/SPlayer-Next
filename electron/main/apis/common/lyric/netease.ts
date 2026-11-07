/**
 * Netease 歌词匹配
 *
 * 两个入口：
 *  - getByPlatformId(id)    按 Netease song id 直取
 *  - getByQuery(track)      search → pickBestCandidate → 单次请求拿歌词
 *
 * 返回只带原生格式文本（yrc / lrc + 翻译 / 罗马音），不做解析，交给渲染端。
 */

import { callNetease } from "@main/apis/netease";
import { withLyricCache } from "@main/database/lyricCache";
import { buildFingerprint, getMatchedId, setMatchedId } from "@main/database/lyricMatchCache";
import { coreLog } from "@main/utils/logger";
import type { LyricMatchResult } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { prefetchTTML } from "./ttml";
import { buildLyricSearchKeyword, pickBestCandidate, type LyricCandidate } from "./utils";

/** 主歌词：yrc 优先，其次 lrc */
const pickMain = (
  yrc?: string,
  lrc?: string,
): { content: string; format: "yrc" | "lrc" } | undefined => {
  const yrcContent = yrc?.trim();
  if (yrcContent) return { content: yrcContent, format: "yrc" };
  const lrcContent = lrc?.trim();
  if (lrcContent) return { content: lrcContent, format: "lrc" };
  return undefined;
};

/**
 * 翻译 / 罗马音：`ytlrc` / `yromalrc` 时间戳更贴 YRC 行边界，优先选用
 */
const pickSub = (
  yPaired?: string,
  plain?: string,
): { content: string; format: "lrc" } | undefined => {
  const preferred = yPaired?.trim();
  if (preferred) return { content: preferred, format: "lrc" };
  const fallback = plain?.trim();
  if (fallback) return { content: fallback, format: "lrc" };
  return undefined;
};

/**
 * 按 id 直取歌词
 * @param id 歌曲 id
 * @param prefetch 是否预热 TTML，手动选择的歌词不做 TTML 升级，不需要预热
 */
export const getByPlatformId = async (
  id: string,
  prefetch = true,
): Promise<LyricMatchResult | null> => {
  if (prefetch) prefetchTTML("netease", [id]);
  const result = await withLyricCache("netease", id, async () => {
    try {
      const { status, body } = await callNetease("lyric_new", { id });
      if (status !== 200 || body.code !== 200) return null;
      // 主歌词：yrc > lrc
      const main = pickMain(body.yrc?.lyric, body.lrc?.lyric);
      if (!main) return null;
      // 翻译 / 罗马音
      const trans = pickSub(body.ytlrc?.lyric, body.tlyric?.lyric);
      const roma = pickSub(body.yromalrc?.lyric, body.romalrc?.lyric);
      return {
        platform: "netease",
        format: main.format,
        content: main.content,
        translation: trans?.content,
        translationFormat: trans?.format,
        romaji: roma?.content,
        romajiFormat: roma?.format,
      };
    } catch (err) {
      coreLog.warn(`[lyric:netease] getByPlatformId(${id}) failed:`, err);
      return null;
    }
  });
  // 纠正旧版本缓存格式
  if (result?.translationFormat === "yrc") result.translationFormat = "lrc";
  if (result?.romajiFormat === "yrc") result.romajiFormat = "lrc";
  return result;
};

/**
 * 搜索歌词候选
 * @param keyword 搜索关键词
 * @returns 归一化后的候选列表
 */
export const searchCandidates = async (
  keyword: string,
): Promise<LyricCandidate<{ id: string }>[]> => {
  const { status, body } = await callNetease("cloudsearch", {
    keywords: keyword,
    type: 1,
    limit: 20,
  });
  if (status !== 200) throw new Error(`cloudsearch status=${status}`);
  return (body.result?.songs ?? []).map(
    (song: {
      id: number | string;
      name: string;
      ar?: { name: string }[];
      al?: { name?: string };
      dt?: number;
    }) => ({
      name: song.name,
      artist: (song.ar ?? []).map((artist) => artist.name).join(" / "),
      album: song.al?.name,
      duration: song.dt,
      extra: { id: String(song.id) },
    }),
  );
};

/**
 * 按 Track 元数据模糊搜索：search → 挑最佳 → 单次请求歌词
 * @param track 歌曲信息
 */
export const getByQuery = async (track: Track): Promise<LyricMatchResult | null> => {
  // 命中映射缓存：跳过 search → 直接走 byId
  const fingerprint = buildFingerprint(track);
  const cached = getMatchedId(fingerprint, "netease");
  if (cached) return getByPlatformId(cached.platformId);

  const keyword = buildLyricSearchKeyword(track);
  if (!keyword) return null;
  let candidates: LyricCandidate<{ id: string }>[];
  try {
    candidates = await searchCandidates(keyword);
  } catch (err) {
    coreLog.warn(`[lyric:netease] search("${keyword}") failed:`, err);
    return null;
  }
  const best = pickBestCandidate(candidates, track);
  coreLog.info(
    `[lyric:netease] fuzzy "${keyword}" → ${candidates.length} hits, best=${best?.name ?? "none"}`,
  );
  if (!best) return null;
  setMatchedId(fingerprint, "netease", best.extra.id);
  return getByPlatformId(best.extra.id);
};
