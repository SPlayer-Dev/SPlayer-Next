/**
 * SRT 字幕格式解析器
 *
 * 格式：
 * ```
 * 序号
 * 起始时间 --> 结束时间
 * 文本行（1~3 行）
 * 空行分隔
 * ```
 *
 * 时间格式：HH:MM:SS,mmm（逗号或点号分隔毫秒）
 *
 * 文本行规则（从最后一行往上）：
 * - 1 行：原词
 * - 2 行：翻译 + 原词
 * - 3 行：音译 + 翻译 + 原词
 */

import type { LyricLine } from "@shared/types/lyrics";

/** 匹配 SRT 时间戳 HH:MM:SS,mmm */
const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

/**
 * 解析 SRT 时间戳为毫秒
 * @param value 时间戳字符串，如 "00:01:23,456"
 */
const parseSrtTime = (value: string): number => {
  const m = TIME_RE.exec(value);
  if (!m) return 0;
  const hr = parseInt(m[1]);
  const min = parseInt(m[2]);
  const sec = parseInt(m[3]);
  let ms = parseInt(m[4]);
  // 归一化毫秒位数
  if (m[4].length === 1) ms *= 100;
  else if (m[4].length === 2) ms *= 10;
  return ((hr * 60 + min) * 60 + sec) * 1000 + ms;
};

/**
 * 解析 SRT 字幕文本
 * @param text SRT 文本内容
 * @returns 解析后的歌词行数组
 */
export const parseSRT = (text: string): LyricLine[] => {
  const lines: LyricLine[] = [];
  // 按空行分割为 block
  const blocks = text.replace(/\r\n/g, "\n").split(/\n\n+/);

  for (const block of blocks) {
    const parts = block.trim().split("\n");
    // 至少需要：序号 + 时间行 + 文本行
    if (parts.length < 3) continue;

    // 第一行是序号
    if (!/^\d+$/.test(parts[0].trim())) continue;

    // 第二行是时间范围
    const timeLine = parts[1];
    const arrowIdx = timeLine.indexOf("-->");
    if (arrowIdx === -1) continue;

    const startTime = parseSrtTime(timeLine.slice(0, arrowIdx));
    const endTime = parseSrtTime(timeLine.slice(arrowIdx + 3));

    // 剩余行为文本内容
    const textLines = parts
      .slice(2)
      .filter((l) => l.trim())
      .map((l) => l.trim());
    if (textLines.length === 0) continue;

    // 最后一行是原词，往上依次是翻译、音译
    const count = textLines.length;
    const mainText = textLines[count - 1];
    const translatedLyric = count >= 2 ? textLines[count - 2] : "";
    const romanLyric = count >= 3 ? textLines[count - 3] : "";

    // 检测行内括号背景
    const words: LyricLine["words"] = [{ startTime, endTime, word: mainText }];
    if (words.length < 2) {
      lines.push({
        words,
        translatedLyric,
        romanLyric,
        startTime,
        endTime,
        isBG: false,
        isDuet: false,
      });
      continue;
    }

    // 检测行内括号背景（非行尾尾随）
    if (
      !words[0].word.startsWith("(") &&
      !words[0].word.startsWith("（") &&
      !words[words.length - 1].word.endsWith(")") &&
      !words[words.length - 1].word.endsWith(")")
    ) {
      // 从后向前查找配对括号
      let closeIndex = -1;
      let openIndex = -1;
      for (let i = words.length - 1; i >= 0; i--) {
        if (words[i].word.endsWith(")") || words[i].word.endsWith(")")) {
          closeIndex = i;
          // 向前寻找配对的开括号
          for (let j = i - 1; j >= 0; j--) {
            if (words[j].word.startsWith("(") || words[j].word.startsWith("（")) {
              openIndex = j;
              break;
            }
          }
          if (openIndex >= 0) break;
        }
      }

      if (openIndex >= 0 && closeIndex >= openIndex) {
        // 检查括号内容是否主要是日文假名，如果是则跳过
        const bracketContent = words
          .slice(openIndex, closeIndex + 1)
          .map((w) =>
            w.word
              .replace(/^[（(]/, "")
              .replace(/[）)]$/, "")
              .trim(),
          )
          .join("");
        const KANA_ONLY_RE = /^[\p{Script=Hiragana}\p{Script=Katakana}ー\s]+$/u;
        const cleanedForCheck = bracketContent.replace(/[()\s]/g, "");

        // 空括号直接跳过
        if (!cleanedForCheck) continue;

        const isPureKana = cleanedForCheck.length > 0 && KANA_ONLY_RE.test(cleanedForCheck);

        if (!isPureKana) {
          // 克隆括号段（含开闭括号单词），剥离括号内容
          const bgWords: LyricLine["words"] = [];
          for (let k = openIndex; k <= closeIndex; k++) {
            const w = { ...words[k] };
            bgWords.push(w);
          }
          bgWords[0].word = bgWords[0].word.replace(/^[（(]/, "");
          bgWords[bgWords.length - 1].word = bgWords[bgWords.length - 1].word.replace(/[）)]$/, "");
          const cleaned = bgWords.filter((w) => w.word.trim() !== "");
          if (cleaned.length > 0) {
            // 主行裁掉括号段
            words.splice(openIndex, closeIndex - openIndex + 1);
            // 添加背景行
            lines.push({
              words: cleaned,
              translatedLyric: "",
              romanLyric: "",
              startTime: cleaned[0].startTime,
              endTime: cleaned[cleaned.length - 1].endTime,
              isBG: true,
              isDuet: false,
            });
          }
        }
      }
    }

    lines.push({
      words,
      translatedLyric,
      romanLyric,
      startTime,
      endTime,
      isBG: false,
      isDuet: false,
    });
  }

  return lines;
};
