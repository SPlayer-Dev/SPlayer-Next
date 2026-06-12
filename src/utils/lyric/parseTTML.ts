/**
 * TTML（Apple Music）歌词解析器
 *
 * 支持特性：
 * - 逐字时间戳（span begin/end）
 * - 背景歌词行（role="x-bg"）
 * - 对唱标记（agent 属性）
 * - 行内翻译（role="x-translation"）和音译（role="x-roman"）
 * - iTunes 翻译元数据（translations 段）
 * - iTunes 音译元数据（transliterations 段，行级 + 逐词罗马音）
 * - 逐字间有意义的空格保留
 */

import type { LyricLine, LyricWord } from "@shared/types/lyrics";
import { parseTTMLTime } from "./timestamp";

/**
 * 获取元素属性值，兼容命名空间前缀（如 ttm:agent → agent）
 * @param el 目标元素
 * @param name 属性名（不含前缀）
 */
const getAttr = (el: Element, name: string): string | null => {
  const direct = el.getAttribute(name);
  if (direct !== null) return direct;
  for (const attr of Array.from(el.attributes)) {
    if (attr.localName === name || attr.name.endsWith(":" + name)) {
      return attr.value;
    }
  }
  return null;
};

/**
 * 递归提取 span 中的纯文本，跳过翻译和音译子 span
 * @param el 目标元素
 */
const getWordText = (el: Element): string => {
  let text = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const role = getAttr(node as Element, "role");
      if (role !== "x-translation" && role !== "x-roman") {
        text += getWordText(node as Element);
      }
    }
  }
  return text;
};

/**
 * 查找 TTML 中的主 agent ID（第一个 type="person" 的 agent）
 * @param doc XML 文档
 */
const findMainAgent = (doc: Document): string => {
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    if (el.localName === "agent" && el.getAttribute("type") === "person") {
      const id = el.getAttribute("xml:id") || getAttr(el, "id");
      if (id) return id;
    }
  }
  return "v1";
};

/**
 * 去掉首尾括号（背景歌词文本常以括号包裹）
 * @param text 原始文本
 */
const stripParens = (text: string): string =>
  text
    .trim()
    .replace(/^[（(]/, "")
    .replace(/[)）]$/, "")
    .trim();

/**
 * 收集 iTunes 翻译元数据（translations 段中的 text[for] 元素）
 * @param doc XML 文档
 */
const collectTranslations = (doc: Document): Map<string, { main: string; bg: string }> => {
  const translations = new Map<string, { main: string; bg: string }>();

  for (const textEl of Array.from(doc.querySelectorAll("text[for]"))) {
    const parent = textEl.parentElement;
    if (!parent || (parent.localName !== "translation" && !parent.closest("translations"))) {
      continue;
    }

    const key = textEl.getAttribute("for");
    if (!key) continue;

    let main = "";
    let bg = "";
    for (const node of Array.from(textEl.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        main += node.textContent ?? "";
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const role = getAttr(node as Element, "role");
        if (role === "x-bg") bg += node.textContent ?? "";
      }
    }

    main = main.trim();
    bg = stripParens(bg);
    if (main || bg) translations.set(key, { main, bg });
  }

  return translations;
};

/** 逐词罗马音条目 */
interface RomanWord {
  startTime: number;
  endTime: number;
  text: string;
}

/** 音译收集结果：行级文本 + 逐词条目 */
interface TransliterationMaps {
  lines: Map<string, { main: string; bg: string }>;
  words: Map<string, { main: RomanWord[]; bg: RomanWord[] }>;
}

/**
 * 收集 iTunes 音译元数据（transliterations 段中的 text[for] 元素）
 *
 * 纯文本节点累积为行级音译；带 begin/end 的子 span 视为逐词罗马音，
 * 嵌套在 x-bg 元素内的归背景行
 * @param doc XML 文档
 */
const collectTransliterations = (doc: Document): TransliterationMaps => {
  const lines = new Map<string, { main: string; bg: string }>();
  const words = new Map<string, { main: RomanWord[]; bg: RomanWord[] }>();

  for (const textEl of Array.from(doc.querySelectorAll("text[for]"))) {
    const parent = textEl.parentElement;
    if (
      !parent ||
      (parent.localName !== "transliteration" && !parent.closest("transliterations"))
    ) {
      continue;
    }

    const key = textEl.getAttribute("for");
    if (!key) continue;

    const mainWords: RomanWord[] = [];
    const bgWords: RomanWord[] = [];
    let lineMain = "";
    let lineBg = "";

    for (const node of Array.from(textEl.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        lineMain += node.textContent ?? "";
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const childEl = node as Element;
        if (getAttr(childEl, "role") === "x-bg") {
          const timedSpans = Array.from(childEl.querySelectorAll("span[begin][end]"));
          if (timedSpans.length > 0) {
            for (const span of timedSpans) {
              bgWords.push({
                startTime: parseTTMLTime(span.getAttribute("begin") ?? ""),
                endTime: parseTTMLTime(span.getAttribute("end") ?? ""),
                text: stripParens(span.textContent ?? ""),
              });
            }
          } else {
            lineBg += childEl.textContent ?? "";
          }
        } else if (childEl.hasAttribute("begin") && childEl.hasAttribute("end")) {
          mainWords.push({
            startTime: parseTTMLTime(childEl.getAttribute("begin") ?? ""),
            endTime: parseTTMLTime(childEl.getAttribute("end") ?? ""),
            text: childEl.textContent ?? "",
          });
        }
      }
    }

    if (mainWords.length > 0 || bgWords.length > 0) {
      words.set(key, { main: mainWords, bg: bgWords });
    }

    lineMain = lineMain.trim();
    lineBg = stripParens(lineBg);
    if (lineMain || lineBg) lines.set(key, { main: lineMain, bg: lineBg });
  }

  return { lines, words };
};

/**
 * 解析 TTML 歌词文本
 * @param text TTML XML 文本内容
 * @returns 解析后的歌词行数组
 * @throws 当 XML 解析失败时抛出错误
 */
export const parseTTML = (text: string): LyricLine[] => {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid TTML XML");
  }

  const mainAgent = findMainAgent(doc);
  const translations = collectTranslations(doc);
  const transliterations = collectTransliterations(doc);
  const lines: LyricLine[] = [];

  /**
   * 递归解析段落元素（支持嵌套背景行）
   */
  const parseParagraph = (
    el: Element,
    isBG: boolean,
    isDuet: boolean,
    parentKey: string | null,
  ): void => {
    const begin = getAttr(el, "begin");
    const end = getAttr(el, "end");

    const line: LyricLine = {
      words: [],
      translatedLyric: "",
      romanLyric: "",
      isBG,
      isDuet: isBG ? isDuet : !!getAttr(el, "agent") && getAttr(el, "agent") !== mainAgent,
      startTime: begin ? parseTTMLTime(begin) : 0,
      endTime: end ? parseTTMLTime(end) : 0,
    };

    // 应用 iTunes 翻译与行级音译
    const itunesKey = isBG ? parentKey : getAttr(el, "key");
    if (itunesKey) {
      const trans = translations.get(itunesKey);
      if (trans) line.translatedLyric = isBG ? trans.bg : trans.main;
      const lineRoman = transliterations.lines.get(itunesKey);
      if (lineRoman) line.romanLyric = isBG ? lineRoman.bg : lineRoman.main;
    }

    // 逐词罗马音候选，按起止时间精确匹配后逐个消耗
    const romanWordData = itunesKey ? transliterations.words.get(itunesKey) : undefined;
    const availableRomanWords = romanWordData
      ? [...(isBG ? romanWordData.bg : romanWordData.main)]
      : [];

    let bgCount = 0;
    let lastWasTimedSpan = false;

    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const word = node.textContent ?? "";
        if (word.trim()) {
          // 非空文本节点作为无时间标记的单词
          line.words.push({ word, startTime: line.startTime, endTime: line.endTime });
          lastWasTimedSpan = false;
        } else if (
          lastWasTimedSpan &&
          word.includes(" ") &&
          !word.includes("\n") &&
          !word.includes("\r")
        ) {
          // 逐字 span 之间有意义的空格，保留为空白单词
          const lastWord = line.words[line.words.length - 1];
          line.words.push({
            word: " ",
            startTime: lastWord?.endTime ?? line.startTime,
            endTime: lastWord?.endTime ?? line.startTime,
          });
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const span = node as Element;
        if (span.localName !== "span") continue;
        const role = getAttr(span, "role");

        if (role === "x-bg") {
          // 背景歌词行，递归解析
          parseParagraph(span, true, line.isDuet, itunesKey);
          bgCount++;
        } else if (role === "x-translation") {
          // 行内翻译
          if (!line.translatedLyric) {
            line.translatedLyric = span.textContent?.trim() ?? "";
          }
        } else if (role === "x-roman") {
          // 行内音译
          if (!line.romanLyric) {
            line.romanLyric = span.textContent?.trim() ?? "";
          }
        } else {
          // 逐字 span
          const wb = getAttr(span, "begin");
          const we = getAttr(span, "end");
          if (wb && we) {
            const lyricWord: LyricWord = {
              word: getWordText(span),
              startTime: parseTTMLTime(wb),
              endTime: parseTTMLTime(we),
            };
            if (availableRomanWords.length > 0) {
              const matchIdx = availableRomanWords.findIndex(
                (roman) =>
                  roman.startTime === lyricWord.startTime && roman.endTime === lyricWord.endTime,
              );
              if (matchIdx !== -1) {
                lyricWord.romanWord = availableRomanWords[matchIdx].text;
                availableRomanWords.splice(matchIdx, 1);
              }
            }
            line.words.push(lyricWord);
            lastWasTimedSpan = true;
          }
        }
      }
    }

    // 行级时间未设置时，从逐字时间推断
    if (!begin || !end) {
      const timed = line.words.filter((w) => w.word.trim());
      if (timed.length) {
        line.startTime = Math.min(...timed.map((w) => w.startTime));
        line.endTime = Math.max(...timed.map((w) => w.endTime));
      }
    }

    // 背景歌词去掉首尾括号
    if (isBG && line.words.length) {
      const first = line.words[0];
      if (/^[（(]/.test(first.word)) {
        first.word = first.word.replace(/^[（(]/, "");
        if (!first.word) line.words.shift();
      }
      const last = line.words[line.words.length - 1];
      if (last && /[)）]$/.test(last.word)) {
        last.word = last.word.replace(/[)）]$/, "");
        if (!last.word) line.words.pop();
      }
    }

    // 背景行排在主行后面
    if (bgCount > 0) {
      const bgLines = lines.splice(lines.length - bgCount, bgCount);
      lines.push(line, ...bgLines);
    } else {
      lines.push(line);
    }
  };

  // 遍历所有带时间标记的 <p> 元素
  for (const p of Array.from(doc.querySelectorAll("p"))) {
    if (getAttr(p, "begin") && getAttr(p, "end")) {
      parseParagraph(p, false, false, null);
    }
  }

  return lines;
};
