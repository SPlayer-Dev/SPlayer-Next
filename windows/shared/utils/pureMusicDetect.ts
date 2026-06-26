import type { LyricLine } from "@shared/types/lyrics";

/** 信息性行关键词 */
const INFO_KEYWORDS = ["作词", "作曲", "编曲", "歌词", "获取", "来源", "演唱", "混音", "制作"];

/** 判断是否为信息性行 */
function isInformationalLine(text: string): boolean {
  return INFO_KEYWORDS.some((k) => text.includes(k));
}

/**
 * 检测歌词是否为纯音乐
 * 参照 TaskbarLyrics 的 LyricDocument.IsPureMusic
 * @param lines - 歌词行数组
 * @returns 是否为纯音乐
 */
export function isPureMusic(lines: LyricLine[]): boolean {
  const contentLines = lines
    .map((line) => line.words.map((w) => w.word).join("").trim())
    .filter((text) => text.length > 0 && !isInformationalLine(text));
  return contentLines.length === 1 && contentLines[0].includes("纯音乐");
}
