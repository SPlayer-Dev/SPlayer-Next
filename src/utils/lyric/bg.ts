import type { LyricLine, LyricWord } from "@shared/types/lyrics";

/** 行首括号（全 / 半角），允许前导空格 */
const OPEN_PAREN_RE = /^\s*[（(]/;

/** 行尾括号（全 / 半角） */
const CLOSE_PAREN_RE = /[）)]$/;

/** 汉字 */
const HAN_RE = /\p{Script=Han}/u;

/** 日文假名 */
const KANA_ONLY_RE = /^[\p{Script=Hiragana}\p{Script=Katakana}\u30fc\s]+$/u;

const joinedWords = (words: LyricWord[]): string => words.map((word) => word.word).join("");

const stripParens = (text: string): string =>
  text
    .replace(/^[\s（(]+/, "")
    .replace(/[）)\s]+$/, "")
    .trim();

/** 是否为日文汉字后的假名注音 */
const isJapaneseRubyTail = (words: LyricWord[], openIndex: number): boolean => {
  const before = joinedWords(words.slice(0, openIndex)).trim();
  const prevChar = Array.from(before).at(-1) ?? "";
  if (!HAN_RE.test(prevChar)) return false;
  const rubyText = stripParens(joinedWords(words.slice(openIndex)));
  return !!rubyText && KANA_ONLY_RE.test(rubyText);
};

/**
 * 检测整行是否为背景人声并就地剥离包裹括号
 * @param words - 行内单词数组，命中时原地修改首尾单词
 * @param enabled - 是否启用括号启发式检测
 * @returns 是否为背景人声行
 */
export const detectBackgroundLine = (words: LyricWord[], enabled = true): boolean => {
  if (!enabled) return false;
  if (words.length === 0) return false;
  const first = words[0];
  const last = words[words.length - 1];
  if (!OPEN_PAREN_RE.test(first.word) || !CLOSE_PAREN_RE.test(last.word)) return false;
  first.word = first.word.replace(OPEN_PAREN_RE, "");
  last.word = last.word.replace(CLOSE_PAREN_RE, "");
  return true;
};

/**
 * 把一行里「行尾的 (…) 段」拆成独立的背景人声行（主歌词（和声）这类行内和声）
 *
 * 仅在：整行非括号包裹（那归 detectBackgroundLine）、行尾以 ) 收尾、能往前找到配对的
 * ( 开头字、且 ( 之前还有主歌词时才拆。命中时原地裁掉 line 的尾随段并收紧其 endTime。
 * 引擎把紧随主行的 isBG 行配对为该主行的背景行，故拆出的行需作为下一条数组元素紧跟主行。
 * @param line - 已构建的一行（命中时 words / endTime 被原地修改）
 * @param enabled - 是否启用括号启发式检测
 * @returns 拆出的背景人声行；未命中返回 null
 */
export const splitTrailingBackground = (line: LyricLine, enabled = true): LyricLine | null => {
  if (!enabled) return null;
  const words = line.words;
  if (words.length < 2) return null;
  // 整行包裹交给 detectBackgroundLine，这里只管行内尾随
  if (OPEN_PAREN_RE.test(words[0].word)) return null;
  if (!CLOSE_PAREN_RE.test(words[words.length - 1].word)) return null;
  // 从尾向前找配对的开括号字；须留出前面的主歌词，故下标 ≥ 1
  let openIndex = -1;
  for (let index = words.length - 1; index >= 1; index--) {
    if (OPEN_PAREN_RE.test(words[index].word)) {
      openIndex = index;
      break;
    }
  }
  if (openIndex < 1) return null;
  if (isJapaneseRubyTail(words, openIndex)) return null;
  // 克隆尾随段，剥首尾括号、丢掉因独立括号字而变空的字；未命中时不污染原 words
  const bgWords: LyricWord[] = words.slice(openIndex).map((word) => ({ ...word }));
  bgWords[0].word = bgWords[0].word.replace(OPEN_PAREN_RE, "");
  bgWords[bgWords.length - 1].word = bgWords[bgWords.length - 1].word.replace(CLOSE_PAREN_RE, "");
  const cleaned = bgWords.filter((word) => word.word !== "");
  if (cleaned.length === 0) return null;
  // 主行裁掉尾随段并收紧 endTime
  line.words = words.slice(0, openIndex);
  line.endTime = line.words[line.words.length - 1].endTime;
  return {
    words: cleaned,
    translatedLyric: "",
    romanLyric: "",
    startTime: cleaned[0].startTime,
    endTime: cleaned[cleaned.length - 1].endTime,
    isBG: true,
    isDuet: false,
  };
};
