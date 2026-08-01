import type { LyricLine, LyricWord } from "@shared/types/lyrics";

/** 行首括号（全 / 半角），允许前导空格 */
const OPEN_PAREN_RE = /^\s*[（(]/;

/** 行尾括号（全 / 半角） */
const CLOSE_PAREN_RE = /[）)]$/;

/** 汉字 */
const HAN_RE = /\p{Script=Han}/u;

/** 日文假名 */
const KANA_ONLY_RE = /^[\p{Script=Hiragana}\p{Script=Katakana}\u30fc\s]+$/u;

/** 判断字符串是否主要由日文假名组成（用于排除日语注音） */
const isPureKana = (text: string): boolean => {
  const cleaned = text.replace(/[()\s]/g, '');
  if (cleaned.length === 0) return false;
  return KANA_ONLY_RE.test(cleaned);
};

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
 * 支持多种模式：
 * 1. 单词：单个单词完整被括号包围（如 "(interlude)"、"（间奏）"、"( Uh-huh )"）→ 背景，剥离外层括号
 * 2. 多词：首词以 ( 开头且尾词以 ) 结尾 → 整行背景，剥离首尾括号
 * @param words - 行内单词数组，命中时原地修改相关单词
 * @param enabled - 是否启用括号启发式检测
 * @returns 是否为背景人声行
 */
export const detectBackgroundLine = (words: LyricWord[], enabled = true): boolean => {
  if (!enabled || words.length === 0) return false;

  // 辅助：剥离单个单词的最外层括号（兼容内部空白及全半角）
  const unwrapSingleWord = (word: string): string | null => {
    const trimmed = word.trim();
    if (trimmed.length < 2) return null;
    const startOpen = trimmed[0] === '(' || trimmed[0] === '（';
    const endClose = trimmed[trimmed.length - 1] === ')' || trimmed[trimmed.length - 1] === '）';
    if (startOpen && endClose) {
      return trimmed.slice(1, -1).trim();
    }
    return null;
  };

  // 单行情况：检查整个单词是否被括号包围
  if (words.length === 1) {
    const unwrapped = unwrapSingleWord(words[0].word);
    if (unwrapped !== null) {
      words[0].word = unwrapped;
      return true;
    }
    return false;
  }

  // 多词情况：仅当首词以左括号开头且末词以右括号结尾时视为整行背景
  const first = words[0];
  const last = words[words.length - 1];
  if (OPEN_PAREN_RE.test(first.word) && CLOSE_PAREN_RE.test(last.word)) {
    first.word = first.word.replace(OPEN_PAREN_RE, "").trim();
    last.word = last.word.replace(CLOSE_PAREN_RE, "").trim();
    return true;
  }

  return false;
};

/**
 * 把一行里「括号段」拆成独立的背景人声行（支持行内任意位置的括号）
 * 例如："主歌 (and then) 副歌" → 主歌行 + (and then) 背景行
 * 注意：会跳过纯日文假名为主的括号内容（如日语注音），避免误判。
 * @param line - 已构建的一行（命中时 words / endTime 被原地修改）
 * @param enabled - 是否启用括号启发式检测
 * @returns 拆出的背景人声行；未命中返回 null
 */
export const splitParentheticalBackground = (line: LyricLine, enabled = true): LyricLine | null => {
  if (!enabled) return null;
  const words = line.words;
  if (words.length < 2) return null;

  // 从后向前查找配对括号
  let closeIndex = -1;
  let openIndex = -1;
  for (let i = words.length - 1; i >= 0; i--) {
    if (CLOSE_PAREN_RE.test(words[i].word)) {
      closeIndex = i;
      // 向前寻找配对的开括号
      for (let j = i - 1; j >= 0; j--) {
        if (OPEN_PAREN_RE.test(words[j].word)) {
          openIndex = j;
          break;
        }
      }
      if (openIndex >= 0) break;
    }
  }

  if (openIndex < 0 || closeIndex < openIndex) return null;

  // 确保开括号前至少有一个非背景的主歌词单词
  if (openIndex === 0) return null;

  // 检查括号内容是否主要是日文假名，如果是则跳过（避免将日语注音误认为背景歌词）
  const bracketContent = words.slice(openIndex, closeIndex + 1)
    .map(w => w.word.replace(OPEN_PAREN_RE, "").replace(CLOSE_PAREN_RE, "").trim())
    .join("");

  if (isPureKana(bracketContent)) {
    return null;
  }

  // 克隆括号段（含开闭括号单词），剥离括号内容
  const bgWords: LyricWord[] = [];
  for (let k = openIndex; k <= closeIndex; k++) {
    const w = { ...words[k] };
    bgWords.push(w);
  }
  bgWords[0].word = bgWords[0].word.replace(OPEN_PAREN_RE, "");
  bgWords[bgWords.length - 1].word = bgWords[bgWords.length - 1].word.replace(CLOSE_PAREN_RE, "");
  const cleaned = bgWords.filter((w) => w.word.trim() !== "");
  if (cleaned.length === 0) return null;

  // 主行裁掉括号段并收紧到 openIndex 之前的最后一个词的 endTime
  line.words = words.slice(0, openIndex);
  const lastMainWord = line.words[line.words.length - 1];
  line.endTime = lastMainWord ? lastMainWord.endTime : line.startTime;

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
