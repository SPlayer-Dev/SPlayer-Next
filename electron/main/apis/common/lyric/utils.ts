/**
 * 歌词候选匹配 - 跨平台共享工具
 *
 * 三端（Netease / QQ / Kugou）搜索返回的候选结构不同，归一化成本结构后
 * 用 pickBestCandidate 挑出最匹配当前 track 的那一个，避免对多个候选串行请求歌词。
 */

import type { Track } from "@shared/types/player";

/** 归一化后的候选项 */
export interface LyricCandidate<Extra = unknown> {
  name: string;
  artist: string;
  album?: string;
  /** 毫秒 */
  duration?: number;
  extra: Extra;
}

/** 字符串归一化 */
export const normalize = (text: string | undefined | null): string => {
  if (!text) return "";
  return text.toLowerCase().replace(/[、&;，,/|()·・\s\-_'"`~!?？！.。]+/g, "");
};

/** 双向 includes 命中 */
const bothContains = (left: string, right: string): boolean =>
  left.length > 0 && right.length > 0 && (left.includes(right) || right.includes(left));

/** 时长是否接近 */
const durationClose = (leftMs?: number, rightMs?: number, tolMs = 5000): boolean => {
  if (!leftMs || !rightMs) return false;
  return Math.abs(leftMs - rightMs) <= tolMs;
};

/**
 * 从候选列表里挑出最匹配 track 的那一个
 *
 * 打分规则（分数越高越优先）
 *  - name 全等：+10；name 双向 includes：+4
 *  - artist 全等：+5；artist 双向 includes：+2
 *  - album 全等（且 track 有 album）：+2
 *  - duration 接近（±5s）：+3
 *
 * name 既不等也无 includes 的直接跳过（相关性太差）
 * 最终最高分 < 1 视为无匹配，返回 null
 */
export const pickBestCandidate = <E>(
  candidates: LyricCandidate<E>[],
  track: Track,
): LyricCandidate<E> | null => {
  const trackName = normalize(track.title);
  const trackArtist = normalize(track.artists[0]?.name);
  const trackAlbum = normalize(track.album?.name);
  const trackDuration = track.duration;

  let best: LyricCandidate<E> | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const candName = normalize(candidate.name);
    const candArtist = normalize(candidate.artist);
    const candAlbum = normalize(candidate.album);

    let score = 0;
    if (candName === trackName) score += 10;
    else if (bothContains(candName, trackName)) score += 4;
    else continue;

    if (candArtist === trackArtist) score += 5;
    else if (bothContains(candArtist, trackArtist)) score += 2;

    if (trackAlbum && candAlbum === trackAlbum) score += 2;
    if (durationClose(candidate.duration, trackDuration)) score += 3;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
};
