/**
 * 在线元数据候选排序
 *
 * 规则与主进程歌词匹配（electron/main/apis/common/lyric/utils.ts）保持一致，
 * 区别在于这里服务的是用户手选列表：不做硬过滤，只打分排序 + 标记时长偏差，
 * 由用户最终决定选哪个。
 */

import type { Track } from "@shared/types/player";

/** 排序上下文：表单当前值 + 本地文件时长 */
export interface TagMatchContext {
  title: string;
  artist: string;
  album?: string;
  /** 本地文件时长（毫秒），最强判别字段 */
  durationMs?: number;
}

/** 带评分的候选项 */
export interface RankedTagCandidate {
  track: Track;
  score: number;
  /** 与本地文件时长差超 20s，基本可断定不是同一版本 */
  durationFar: boolean;
}

/** 字符串归一化（与歌词匹配同规则） */
const normalize = (text: string | undefined | null): string => {
  if (!text) return "";
  return text.toLowerCase().replace(/[、&;，,/|()·・\s\-_'"`~!?？！.。]+/g, "");
};

/** 双向 includes 命中 */
const bothContains = (left: string, right: string): boolean =>
  left.length > 0 && right.length > 0 && (left.includes(right) || right.includes(left));

/** 时长差判定（ms） */
const durationDiff = (leftMs?: number, rightMs?: number): number | null => {
  if (!leftMs || !rightMs) return null;
  return Math.abs(leftMs - rightMs);
};

/**
 * 给在线候选打分并降序排列
 * @param candidates - 平台搜索返回的候选曲目
 * @param context - 表单当前值与本地时长
 */
export const rankTagCandidates = (
  candidates: readonly Track[],
  context: TagMatchContext,
): RankedTagCandidate[] => {
  const ctxTitle = normalize(context.title);
  const ctxArtist = normalize(context.artist);
  const ctxAlbum = normalize(context.album);

  const ranked = candidates.map((track) => {
    const candTitle = normalize(track.title);
    const candArtist = normalize(track.artists.map((artist) => artist.name).join(""));
    const candAlbum = normalize(track.album?.name);
    const diff = durationDiff(track.duration, context.durationMs);

    const titleExact = candTitle.length > 0 && candTitle === ctxTitle;
    const artistExact = ctxArtist.length > 0 && candArtist === ctxArtist;

    let score = 0;
    if (titleExact) score += 10;
    else if (bothContains(candTitle, ctxTitle)) score += 4;
    if (artistExact) score += 5;
    else if (bothContains(candArtist, ctxArtist)) score += 2;
    if (ctxAlbum && candAlbum === ctxAlbum) score += 2;
    if (diff !== null && diff <= 5000) score += 3;

    return { track, score, durationFar: diff !== null && diff > 20000 };
  });

  // 时长明显不符的沉底，其余按分数降序
  return ranked.sort((left, right) => {
    if (left.durationFar !== right.durationFar) return left.durationFar ? 1 : -1;
    return right.score - left.score;
  });
};
