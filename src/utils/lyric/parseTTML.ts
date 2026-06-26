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
 * 收集所有演唱者 agent：建立 id→type 映射，并取第一个 type="person" 的 agent 作为主唱
 * @param doc XML 文档
 * @returns 主唱 agent id 与 id→type 映射
 */
const collectAgents = (doc: Document): { mainAgent: string; agentTypes: Map<string, string> } => {
  const agentTypes = new Map<string, string>();
  let mainAgent = "";
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    if (el.localName !== "agent") continue;
    const id = el.getAttribute("xml:id") || getAttr(el, "id");
    if (!id) continue;
    const type = el.getAttribute("type") || "";
    agentTypes.set(id, type);
    if (!mainAgent && type === "person") mainAgent = id;
  }
  return { mainAgent: mainAgent || "v1", agentTypes };
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
 * 规范化语言标签
 * @param lang 原始语言标签
 * @returns 规范化后的语言标签
 */
const normalizeLang = (lang: string | null | undefined): string =>
  (lang ?? "").toLowerCase().replace(/_/g, "-");

/**
 * 从多语言候选中选出最匹配偏好语言的索引
 * @param langs 候选语言标签数组，顺序与候选一致
 * @param preferred 偏好语言标签（如 zh-CN），为空则取首个
 * @returns 选中索引，无合适候选返回 -1
 */
const pickLangIndex = (langs: (string | null)[], preferred: string): number => {
  if (langs.length === 0) return -1;
  const want = normalizeLang(preferred);
  if (!want) return 0;
  const wantBase = want.split("-")[0];
  let baseMatch = -1;
  let hasTagged = false;
  for (let i = 0; i < langs.length; i++) {
    const lang = normalizeLang(langs[i]);
    if (!lang) continue;
    hasTagged = true;
    if (lang === want) return i;
    if (baseMatch === -1 && lang.split("-")[0] === wantBase) baseMatch = i;
  }
  if (baseMatch !== -1) return baseMatch;
  return hasTagged ? -1 : 0;
};

/** 行级翻译候选 */
interface TransCandidate {
  lang: string | null;
  main: string;
  bg: string;
}

/**
 * 收集 iTunes 翻译元数据（translations 段中的 text[for] 元素）
 * 同一行可能有多个语言的 translation 块，按偏好语言挑选最匹配的
 * @param doc XML 文档
 * @param preferredLang 偏好语言标签
 */
const collectTranslations = (
  doc: Document,
  preferredLang: string,
): Map<string, { main: string; bg: string }> => {
  const candidates = new Map<string, TransCandidate[]>();

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
        const childEl = node as Element;
        // x-bg 为背景行翻译；其余 span（含逐字翻译）文本并入主翻译
        if (getAttr(childEl, "role") === "x-bg") {
          bg += childEl.textContent ?? "";
        } else {
          main += childEl.textContent ?? "";
        }
      }
    }

    main = main.trim();
    bg = stripParens(bg);
    if (!main && !bg) continue;

    const lang = getAttr(parent, "lang");
    const list = candidates.get(key) ?? [];
    list.push({ lang, main, bg });
    candidates.set(key, list);
  }

  const translations = new Map<string, { main: string; bg: string }>();
  for (const [key, list] of candidates) {
    const idx = pickLangIndex(
      list.map((item) => item.lang),
      preferredLang,
    );
    if (idx !== -1) translations.set(key, { main: list[idx].main, bg: list[idx].bg });
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
 * 逐词音译对齐：先按起始时间 ±2ms 容差快配，失败再用时间区间交并比（IoU≥10%）兜底
 * @param words 带时间戳的逐字单词（命中时原地写入 romanWord）
 * @param romanWords 逐词罗马音候选（按时间升序）
 */
const alignRomanWords = (words: LyricWord[], romanWords: RomanWord[]): void => {
  if (words.length === 0 || romanWords.length === 0) return;
  const FAST_TRACK_TOLERANCE_MS = 2;
  const MIN_IOU = 0.1;
  let searchStart = 0;
  for (const word of words) {
    let bestIou = 0;
    let bestIdx = -1;
    let fastMatched = false;
    for (let idx = searchStart; idx < romanWords.length; idx++) {
      const roman = romanWords[idx];
      // 快通道：起始时间足够接近直接命中
      if (Math.abs(word.startTime - roman.startTime) <= FAST_TRACK_TOLERANCE_MS) {
        word.romanWord = roman.text;
        searchStart = idx + 1;
        fastMatched = true;
        break;
      }
      // 计算时间区间交并比，记录重叠最大者
      const overlapStart = Math.max(word.startTime, roman.startTime);
      const intersection = Math.max(0, Math.min(word.endTime, roman.endTime) - overlapStart);
      if (intersection > 0) {
        const unionStart = Math.min(word.startTime, roman.startTime);
        const union = Math.max(1, Math.max(word.endTime, roman.endTime) - unionStart);
        const iou = intersection / union;
        if (iou > bestIou) {
          bestIou = iou;
          bestIdx = idx;
        }
      }
      // 候选起始已越过本词结束，后续不再可能重叠
      if (roman.startTime >= word.endTime) break;
    }
    if (!fastMatched && bestIdx !== -1 && bestIou >= MIN_IOU) {
      word.romanWord = romanWords[bestIdx].text;
      searchStart = bestIdx + 1;
    }
  }
};

/**
 * 解析 TTML 歌词文本
 * @param text TTML XML 文本内容
 * @param preferredLang 偏好翻译语言标签
 * @returns 解析后的歌词行数组
 * @throws 当 XML 解析失败时抛出错误
 */
export const parseTTML = (text: string, preferredLang = ""): LyricLine[] => {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid TTML XML");
  }

  const { mainAgent, agentTypes } = collectAgents(doc);
  const translations = collectTranslations(doc, preferredLang);
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
    const lineAgent = getAttr(el, "agent");

    const line: LyricLine = {
      words: [],
      translatedLyric: "",
      romanLyric: "",
      isBG,
      // 合唱（type="group"）行居中、不算对唱，仅非主唱的个人 agent 才右对齐
      isDuet: isBG
        ? isDuet
        : !!lineAgent && lineAgent !== mainAgent && agentTypes.get(lineAgent) !== "group",
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

    // 逐词罗马音候选，循环结束后与逐字 span 统一做时间对齐
    const romanWordData = itunesKey ? transliterations.words.get(itunesKey) : undefined;
    const availableRomanWords = romanWordData
      ? [...(isBG ? romanWordData.bg : romanWordData.main)]
      : [];
    // 本行带时间戳的逐字 span，用于与逐词罗马音对齐
    const timedWords: LyricWord[] = [];

    let bgCount = 0;
    let lastWasTimedSpan = false;
    const transCandidates: { lang: string | null; text: string }[] = [];

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
          // 行内翻译，可能多语言并存，先收集候选
          transCandidates.push({
            lang: getAttr(span, "lang"),
            text: span.textContent?.trim() ?? "",
          });
        } else if (role === "x-roman") {
          // 行内音译
          if (!line.romanLyric) line.romanLyric = span.textContent?.trim() ?? "";
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
            line.words.push(lyricWord);
            timedWords.push(lyricWord);
            lastWasTimedSpan = true;
          }
        }
      }
    }

    // 逐词罗马音与逐字 span 做时间对齐
    alignRomanWords(timedWords, availableRomanWords);

    // 行内多语言翻译按偏好语言挑选
    if (!line.translatedLyric) {
      const valid = transCandidates.filter((item) => item.text);
      const idx = pickLangIndex(
        valid.map((item) => item.lang),
        preferredLang,
      );
      if (idx !== -1) line.translatedLyric = valid[idx].text;
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
