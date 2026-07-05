/**
 * 歌词屏蔽词还原
 *
 * 把歌词里被星号遮盖的脏话还原为原词
 */

/** 还原被星号遮盖的脏话 */
const unmask = (text: string): string => {
  if (!text) return text;
  return text
    .replace(/f\*{2}k/gi, "fuck")
    .replace(/s\*{2}t/gi, "shit")
    .replace(/c\*{2}t/gi, "cunt")
    .replace(/c\*{2}k/gi, "cock")
    .replace(/co\*{2}/gi, "cock")
    .replace(/s\*{2}ker/gi, "sucker")
    .replace(/\*{4}ing/gi, "fucking")
    .replace(/b\*{3}h/gi, "bitch")
    .replace(/d\*{2}k/gi, "dick")
    .replace(/d\*{2}n/gi, "damn")
    .replace(/\*{4}er/gi, "fucker")
    .replace(/as\*{2}le/gi, "asshole")
    .replace(/w\*{3}e/gi, "whore")
    .replace(/n\*{3}a/gi, "nigga");
};

interface UncensorLine {
  words: Array<{ word: string; romanWord?: string }>;
  translatedLyric: string;
  romanLyric: string;
}

/**
 * 对歌词行数组应用屏蔽词还原（原地修改）
 * @param lines - 解析后的歌词行
 */
export const applyProfanityUncensor = <T extends UncensorLine>(lines: T[]): T[] => {
  for (const line of lines) {
    for (const w of line.words) {
      w.word = unmask(w.word);
      if (w.romanWord) w.romanWord = unmask(w.romanWord);
    }
    line.translatedLyric = unmask(line.translatedLyric);
    line.romanLyric = unmask(line.romanLyric);
  }
  return lines;
};
