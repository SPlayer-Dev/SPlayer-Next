import type { LyricLine, LyricWord } from "../types/lyrics";

/**
 * 获取单个单词的纯文本内容（自动处理词尾空格）
 * @param word - 歌词单词节点
 * @returns 处理词尾空格后的单词文本
 */
export const getWordText = (word?: LyricWord | null): string => {
  if (!word) return "";
  return word.word + (word.endsWithSpace && !/\s$/.test(word.word) ? " " : "");
};

/**
 * 获取单个单词的音译文本（自动处理词尾空格）
 * @param word - 歌词单词节点
 * @returns 处理词尾空格后的音译文本，若无音译返回空字符串
 */
export const getWordRomaji = (word?: LyricWord | null): string => {
  if (!word?.romanWord) return "";
  return word.romanWord + (word.endsWithSpace && !/\s$/.test(word.romanWord) ? " " : "");
};

/**
 * 提取歌词行的纯文本内容（自动拼接所有单词并保留西文词间空格）
 * @param line - 歌词行数据
 * @returns 完整纯文本内容
 */
export const getLineText = (line?: LyricLine | null): string => {
  if (!line?.words || line.words.length === 0) return "";
  return line.words.map(getWordText).join("");
};

/**
 * 提取歌词行的音译/罗马音文本
 * 优先采用行级已配对的 romanLyric；若无则自动按逐词音译拼接并保留词尾空格
 * @param line - 歌词行数据
 * @returns 组合后的音译文本
 */
export const getLineRomaji = (line?: LyricLine | null): string => {
  if (!line) return "";
  if (line.romanLyric) return line.romanLyric;
  if (!line.words || line.words.length === 0) return "";
  return line.words.map(getWordRomaji).join("");
};
