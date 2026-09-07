import type { LyricLanguage, LyricLine } from "@shared/types/lyrics";

/** 日语假名：平假名 + 片假名 + 半角假名 + 促音/长音符号 */
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}\u30FC\uFF66-\uFF9F]/u;

/** 韩文：谚文音节 + 谚文字母 + 谚文兼容字母 */
const HANGUL_RE = /[\p{Script=Hangul}\u3130-\u318F]/u;

/** 中日韩统一表意文字（含扩展 A 区） */
const HAN_RE = /\p{Script=Han}/u;

/** 拉丁字母；数字与标点不能作为英文判断依据 */
const LATIN_RE = /\p{Script=Latin}/u;

/** 判断是否有实质内容的翻译歌词 */
const hasTranslation = (line: LyricLine): boolean => line.translatedLyric.trim().length > 0;

/**
 * 为歌词行补充语言信息
 *
 * - Han 脚本无法独立区分中日韩，对此会根据翻译和比例推断语言，详见代码实现
 * - 拉丁文字使用 BCP 47 的 und-Latn，避免误标为英语。
 *
 * @param lines - 已解析的整首歌词
 */
export const applyLyricLanguages = (lines: LyricLine[]): void => {
  const lineContents = lines.map((line) =>
    line.words
      .map((word) => {
        // 这里将 ruby 内容也算作歌词内容的一部分，以考虑纯汉字行但 ruby 为假名的情况
        const rubyText = word.ruby?.map((span) => span.word).join("");
        return `${word.word}${rubyText ? `(${rubyText})` : ""}`;
      })
      .join(""),
  );

  // 统计全局行级 CJK 特征
  let hanLineCount = 0;
  let kanaLineCount = 0;
  let hangulLineCount = 0;
  let kanaTranslatedCount = 0;
  let hangulTranslatedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const content = lineContents[i];
    const isTranslated = hasTranslation(lines[i]);

    if (HAN_RE.test(content)) {
      hanLineCount++;
    }
    if (KANA_RE.test(content)) {
      kanaLineCount++;
      if (isTranslated) kanaTranslatedCount++;
    }
    if (HANGUL_RE.test(content)) {
      hangulLineCount++;
      if (isTranslated) hangulTranslatedCount++;
    }
  }

  const hasHan = hanLineCount > 0;
  const hasKana = kanaLineCount > 0;
  const hasHangul = hangulLineCount > 0;

  // CJK 翻译启发式标志
  const allKanaTranslated = hasKana && kanaTranslatedCount === kanaLineCount;
  const allHangulTranslated = hasHangul && hangulTranslatedCount === hangulLineCount;

  // CJK 比例
  const kanaRatio = hasHan ? kanaLineCount / hanLineCount : Infinity;
  const hangulRatio = hasHan ? hangulLineCount / hanLineCount : Infinity;
  const THRESHOLD = 0.37; // 我猜的

  let mainCJK: LyricLanguage = "zh-CN";
  if (hasHan) {
    if (kanaRatio > THRESHOLD && hangulRatio > THRESHOLD) {
      mainCJK = hangulLineCount > kanaLineCount ? "ko" : "ja";
    } else if (kanaRatio > THRESHOLD) {
      mainCJK = "ja";
    } else if (hangulRatio > THRESHOLD) {
      mainCJK = "ko";
    } else {
      mainCJK = "zh-CN";
    }
  }

  // 判断纯汉字行的语言
  const getPureHanLineLang = (line: LyricLine): LyricLanguage => {
    const isTranslated = hasTranslation(line);

    if (allKanaTranslated) {
      return isTranslated ? "ja" : "zh-CN";
    }
    if (allHangulTranslated) {
      return isTranslated ? "ko" : "zh-CN";
    }

    return mainCJK;
  };

  // 逐行标注
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const content = lineContents[i];

    if (KANA_RE.test(content)) {
      line.language = "ja";
    } else if (HANGUL_RE.test(content)) {
      line.language = "ko";
    } else if (HAN_RE.test(content)) {
      line.language = getPureHanLineLang(line);
    } else if (LATIN_RE.test(content)) {
      line.language = "und-Latn";
    } else {
      delete line.language;
    }
  }
};
