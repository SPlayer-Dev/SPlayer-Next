/**
 * TTML 歌词解析器核心实现
 * 将 Apple Music / AMLL 规范的 TTML XML 解析为结构化 AST
 */

import { normalizeKangxi } from "lyric-kit";
import { Elements, Values } from "./constants";
import type {
  Agent,
  BackgroundVocal,
  LyricLine,
  SubLyricContent,
  Syllable,
  TTMLMetadata,
  TTMLParserOptions,
  TTMLResult,
} from "./types";

interface SidecarStore {
  [lineId: string]: {
    translations?: SubLyricContent[];
    romanizations?: SubLyricContent[];
    bgTranslations?: SubLyricContent[];
    bgRomanizations?: SubLyricContent[];
  };
}

interface ParsedNodeContent {
  fullText: string;
  words: Syllable[];
  translations: SubLyricContent[];
  romanizations: SubLyricContent[];
  bgTranslations: SubLyricContent[];
  bgRomanizations: SubLyricContent[];
  backgroundVocal?: BackgroundVocal;
}

/**
 * 辅助获取元素属性值（支持多候选属性名，如带前缀与不带前缀）
 */
function getAttr(el: Element, ...names: string[]): string | null {
  for (const name of names) {
    const val = el.getAttribute(name);
    if (val !== null && val !== undefined) return val;
  }
  return null;
}

/**
 * 深层查找匹配特定本地标签名的所有元素
 */
function findElementsByLocalName(root: Element | Document, localName: string): Element[] {
  const result: Element[] = [];
  const target = localName.toLowerCase();
  const all = Array.from(root.getElementsByTagName("*"));

  for (const el of all) {
    const current = (el.localName || el.tagName.split(":").pop() || "").toLowerCase();
    if (current === target) {
      result.push(el);
    }
  }
  return result;
}

export class TTMLParser {
  private cleanKangxi: boolean;

  private static readonly TIME_REGEX =
    /^(?:(?:(?<hours>\d+):)?(?<minutes>\d+):)?(?<seconds>\d+(?:\.\d+)?)$/;
  private static readonly LEADING_SPACE_REGEX = /^\s/;
  private static readonly TRAILING_SPACE_REGEX = /\s$/;
  private static readonly MULTI_SPACE_REGEX = /\s+/g;

  constructor(options?: TTMLParserOptions) {
    this.cleanKangxi = Boolean(options?.cleanKangxi);
  }

  /**
   * 静态便捷解析入口
   */
  public static parse(xmlStr: string, options?: TTMLParserOptions): TTMLResult {
    return new TTMLParser(options).parse(xmlStr);
  }

  /**
   * 解析 TTML XML 字符串为 AST
   */
  public parse(xmlStr: string): TTMLResult {
    if (!xmlStr || typeof xmlStr !== "string" || xmlStr.trim().length === 0) {
      throw new Error("TTMLParser: Input must be a non-empty XML string.");
    }

    if (typeof DOMParser === "undefined") {
      throw new Error(
        "TTMLParser: Standard DOMParser is not available in the current environment.",
      );
    }

    const preparedXml = this.cleanKangxi ? normalizeKangxi(xmlStr) : xmlStr;
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(preparedXml, Values.MimeXML);

    const parserErrors = doc.getElementsByTagName("parsererror");
    if (parserErrors.length > 0) {
      throw new Error(`TTMLParser: XML parsing error: ${parserErrors[0].textContent}`);
    }

    const root = doc.documentElement;
    if (!root) {
      throw new Error("TTMLParser: Missing document root element.");
    }

    const { metadata, sidecar } = this.parseHead(doc);

    const result: TTMLResult = {
      metadata,
      lines: [],
    };

    const lang = getAttr(root, "xml:lang", "lang");
    if (lang) result.metadata.language = lang;

    const timing = getAttr(root, "itunes:timing", "timing");
    if (timing === Values.Word || timing === Values.Line) {
      result.metadata.timingMode = timing;
    }

    this.parseBody(doc, result, sidecar);

    result.metadata.timingMode ??= this.inferTimingMode(result.lines);

    return result;
  }

  /**
   * 解析时间戳字符串为毫秒数值
   */
  public parseTime(timeStr: string | null | undefined): number {
    if (!timeStr) return 0;
    const cleanStr = timeStr.trim();
    if (cleanStr.length === 0) return 0;

    if (cleanStr.endsWith("s")) {
      const seconds = Number(cleanStr.slice(0, -1));
      return Number.isNaN(seconds) ? 0 : Math.round(seconds * 1000);
    }

    const match = cleanStr.match(TTMLParser.TIME_REGEX);
    if (match?.groups) {
      const { seconds, minutes, hours } = match.groups;
      const secNum = Number(seconds);
      const minNum = minutes ? parseInt(minutes, 10) : 0;
      const hrNum = hours ? parseInt(hours, 10) : 0;

      if (!Number.isNaN(secNum) && !Number.isNaN(minNum) && !Number.isNaN(hrNum)) {
        return Math.round((hrNum * 3600 + minNum * 60 + secNum) * 1000);
      }
    }

    return 0;
  }

  private normalizeText(text: string | null | undefined, trim: boolean = true): string {
    if (!text) return "";
    const normalized = text.replace(TTMLParser.MULTI_SPACE_REGEX, " ");
    return trim ? normalized.trim() : normalized;
  }

  private inferTimingMode(lines: LyricLine[]): "Word" | "Line" {
    const hasWordTiming = lines.some(
      (line) => (line.words?.length ?? 0) > 1 || (line.backgroundVocal?.words?.length ?? 0) > 1,
    );
    return hasWordTiming ? "Word" : "Line";
  }

  /**
   * 解析 Head 元素元数据与 Sidecar 翻译/音译
   */
  private parseHead(doc: Document): { metadata: TTMLMetadata; sidecar: SidecarStore } {
    const head = findElementsByLocalName(doc, Elements.Head)[0];
    const metadata: TTMLMetadata = {
      title: [],
      artist: [],
      album: [],
      isrc: [],
      authorIds: [],
      authorNames: [],
      songwriters: [],
      agents: {},
      rawProperties: {},
    };
    const sidecar: SidecarStore = {};

    if (!head) return { metadata, sidecar };

    // 1. 解析 <ttm:title>
    const titles = findElementsByLocalName(head, Elements.Title);
    for (const titleEl of titles) {
      const t = titleEl.textContent?.trim();
      if (t) metadata.title?.push(t);
    }

    // 2. 解析 <ttm:agent>
    const agents = findElementsByLocalName(head, Elements.Agent);
    for (const agentEl of agents) {
      const id = getAttr(agentEl, "xml:id", "id");
      if (!id) continue;
      const type = getAttr(agentEl, "type") || undefined;
      const nameEl = findElementsByLocalName(agentEl, Elements.Name)[0];
      const name = nameEl?.textContent?.trim() || undefined;

      const agentObj: Agent = { id };
      if (type) agentObj.type = type;
      if (name) agentObj.name = name;

      metadata.agents ??= {};
      metadata.agents[id] = agentObj;
    }

    // 3. 解析 <amll:meta>
    const metas = findElementsByLocalName(head, Elements.Meta);
    for (const metaEl of metas) {
      const key = getAttr(metaEl, "key");
      const value = getAttr(metaEl, "value")?.trim();
      if (!key || !value) continue;

      switch (key) {
        case Values.MusicName:
          metadata.title?.push(value);
          break;
        case Values.Artists:
          metadata.artist?.push(value);
          break;
        case Values.Album:
          metadata.album?.push(value);
          break;
        case Values.ISRC:
          metadata.isrc?.push(value);
          break;
        case Values.TTMLAuthorGithub:
          metadata.authorIds?.push(value);
          break;
        case Values.TTMLAuthorGithubLogin:
          metadata.authorNames?.push(value);
          break;
        case Values.NCMMusicId:
        case Values.QQMusicId:
        case Values.SpotifyId:
        case Values.AppleMusicId:
          metadata.platformIds ??= {};
          (metadata.platformIds[key] ??= []).push(value);
          break;
        default:
          metadata.rawProperties ??= {};
          (metadata.rawProperties[key] ??= []).push(value);
          break;
      }
    }

    // 4. 解析 <iTunesMetadata>
    const iTunesMetas = findElementsByLocalName(head, Elements.ITunesMetadata);
    for (const itunes of iTunesMetas) {
      // 词曲作者
      const writers = findElementsByLocalName(itunes, Elements.Songwriter);
      for (const w of writers) {
        const name = w.textContent?.trim();
        if (name) metadata.songwriters?.push(name);
      }

      // 翻译与音译 Sidecar
      this.parseSidecarEntries(
        itunes,
        Elements.Translations,
        Elements.Translation,
        "translations",
        sidecar,
      );
      this.parseSidecarEntries(
        itunes,
        Elements.Transliterations,
        Elements.Transliteration,
        "romanizations",
        sidecar,
      );
    }

    // 去重
    const dedupe = (arr?: string[]): string[] => (arr ? Array.from(new Set(arr)) : []);
    metadata.title = dedupe(metadata.title);
    metadata.artist = dedupe(metadata.artist);
    metadata.album = dedupe(metadata.album);
    metadata.isrc = dedupe(metadata.isrc);
    metadata.authorIds = dedupe(metadata.authorIds);
    metadata.authorNames = dedupe(metadata.authorNames);
    metadata.songwriters = dedupe(metadata.songwriters);

    return { metadata, sidecar };
  }

  private parseSidecarEntries(
    container: Element,
    groupTag: string,
    itemTag: string,
    type: "translations" | "romanizations",
    sidecar: SidecarStore,
  ): void {
    const groups = findElementsByLocalName(container, groupTag);
    for (const g of groups) {
      const items = findElementsByLocalName(g, itemTag);
      for (const item of items) {
        const lang = getAttr(item, "xml:lang", "lang") || undefined;
        const textNodes = findElementsByLocalName(item, Elements.Text);

        for (const textEl of textNodes) {
          const forId = getAttr(textEl, "for");
          if (!forId) continue;

          const parsed = this.parseNodeContent(textEl);
          sidecar[forId] ??= {};

          const mainText = this.normalizeText(parsed.fullText);
          const hasMainWords = parsed.words.length > 0;
          if (mainText || hasMainWords) {
            const sub: SubLyricContent = {
              text: mainText,
              language: lang,
              words: hasMainWords ? parsed.words : undefined,
            };
            (sidecar[forId][type] ??= []).push(sub);
          }

          if (parsed.backgroundVocal) {
            const bgText = this.normalizeText(parsed.backgroundVocal.text);
            const hasBgWords = (parsed.backgroundVocal.words?.length ?? 0) > 0;
            if (bgText || hasBgWords) {
              const bgSub: SubLyricContent = {
                text: bgText,
                language: lang,
                words: hasBgWords ? parsed.backgroundVocal.words : undefined,
              };
              const bgType = type === "translations" ? "bgTranslations" : "bgRomanizations";
              (sidecar[forId][bgType] ??= []).push(bgSub);
            }
          }
        }
      }
    }
  }

  /**
   * 解析 Body 段落结构与歌词行
   */
  private parseBody(doc: Document, result: TTMLResult, sidecar: SidecarStore): void {
    const body = findElementsByLocalName(doc, Elements.Body)[0];
    if (!body) return;

    let currentBlockIndex = 0;

    for (const node of Array.from(body.children)) {
      const tagName = (node.localName || node.tagName.split(":").pop() || "").toLowerCase();

      if (tagName === Elements.Div) {
        currentBlockIndex++;
        const songPart =
          getAttr(node, "itunes:song-part", "itunes:songPart", "song-part", "songPart") ||
          undefined;
        const pList = findElementsByLocalName(node, Elements.P);

        for (const p of pList) {
          this.processLineElement(p, result.lines, sidecar, songPart, currentBlockIndex);
        }
      } else if (tagName === Elements.P) {
        currentBlockIndex++;
        this.processLineElement(node, result.lines, sidecar, undefined, currentBlockIndex);
      }
    }
  }

  private processLineElement(
    p: Element,
    lines: LyricLine[],
    sidecar: SidecarStore,
    songPart?: string,
    blockIndex?: number,
  ): void {
    const id = getAttr(p, "itunes:key", "key", "id") || `L${lines.length + 1}`;
    const agentId = getAttr(p, "ttm:agent", "agent") || undefined;
    const beginAttr = getAttr(p, "begin");
    const endAttr = getAttr(p, "end");
    const originalStartTime = this.parseTime(beginAttr);
    const originalEndTime = this.parseTime(endAttr);

    const parsed = this.parseNodeContent(p);

    // 计算实际起止时间
    let startTime = originalStartTime;
    let endTime = originalEndTime;
    const timedElements = [...parsed.words];
    if (parsed.backgroundVocal) timedElements.push(parsed.backgroundVocal as unknown as Syllable);

    if (timedElements.length > 0) {
      let minStart = Infinity;
      let maxEnd = 0;
      for (const el of timedElements) {
        if (el.startTime < minStart) minStart = el.startTime;
        if (el.endTime > maxEnd) maxEnd = el.endTime;
      }
      if (startTime === 0 || (minStart > 0 && minStart < startTime)) {
        startTime = minStart === Infinity ? 0 : minStart;
      }
      if (endTime === 0 || maxEnd > endTime) {
        endTime = maxEnd;
      }
    }

    const cleanFullText = this.normalizeText(parsed.fullText);

    // 单字音节兜底
    if (
      parsed.words.length === 0 &&
      cleanFullText.length > 0 &&
      (beginAttr !== null || endAttr !== null)
    ) {
      parsed.words.push({
        text: cleanFullText,
        startTime,
        endTime,
        endsWithSpace: false,
      });
    }

    // 格式化尾部单词空格
    if (parsed.words.length > 0) {
      parsed.words[0].text = parsed.words[0].text.trimStart();
      const last = parsed.words[parsed.words.length - 1];
      last.text = last.text.trimEnd();
      last.endsWithSpace = false;
    }

    // 处理背景人声
    const bgVocal = parsed.backgroundVocal;
    if (bgVocal) {
      if (!bgVocal.startTime && bgVocal.words?.length) {
        bgVocal.startTime = Math.min(...bgVocal.words.map((w) => w.startTime));
      }
      if (!bgVocal.endTime && bgVocal.words?.length) {
        bgVocal.endTime = Math.max(...bgVocal.words.map((w) => w.endTime));
      }
      if (!bgVocal.startTime && startTime > 0) bgVocal.startTime = startTime;
      if (!bgVocal.endTime && endTime > 0) bgVocal.endTime = endTime;

      if (parsed.bgTranslations.length > 0) {
        (bgVocal.translations ??= []).push(...parsed.bgTranslations);
      }
      if (parsed.bgRomanizations.length > 0) {
        (bgVocal.romanizations ??= []).push(...parsed.bgRomanizations);
      }
    }

    const line: LyricLine = {
      id,
      text: cleanFullText,
      startTime,
      endTime,
      words: parsed.words.length > 0 ? parsed.words : undefined,
      translations: parsed.translations.length > 0 ? parsed.translations : undefined,
      romanizations: parsed.romanizations.length > 0 ? parsed.romanizations : undefined,
      backgroundVocal: bgVocal,
      agentId,
      songPart,
      blockIndex,
    };

    // 合并 Sidecar
    const ext = sidecar[id];
    if (ext) {
      if (ext.translations) (line.translations ??= []).push(...ext.translations);
      if (ext.romanizations) (line.romanizations ??= []).push(...ext.romanizations);
      if (ext.bgTranslations && line.backgroundVocal) {
        (line.backgroundVocal.translations ??= []).push(...ext.bgTranslations);
      }
      if (ext.bgRomanizations && line.backgroundVocal) {
        (line.backgroundVocal.romanizations ??= []).push(...ext.bgRomanizations);
      }
    }

    lines.push(line);
  }

  /**
   * 解析节点下的文本、逐字 span、Ruby、背景人声与内联翻译
   */
  private parseNodeContent(element: Element): ParsedNodeContent {
    const result: ParsedNodeContent = {
      fullText: "",
      words: [],
      translations: [],
      romanizations: [],
      bgTranslations: [],
      bgRomanizations: [],
    };

    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const rawText = node.textContent || "";
        const isFormatting = rawText.includes("\n");
        if (isFormatting && rawText.trim().length === 0) continue;

        const normalized = this.normalizeText(rawText, false);
        result.fullText += normalized;

        if (!isFormatting && normalized.length > 0 && normalized.trim().length === 0) {
          if (result.words.length > 0) {
            result.words[result.words.length - 1].endsWithSpace = true;
          }
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const role = getAttr(el, "ttm:role", "role");
        const rubyAttr = getAttr(el, "tts:ruby", "ruby");

        if (rubyAttr === Values.RubyContainer) {
          this.parseRubyElement(el, result);
        } else if (role === Values.RoleBg) {
          result.backgroundVocal = this.parseBackgroundVocalElement(el);
        } else if (role === Values.RoleTranslation) {
          const trans = this.parseInlineSubContent(el);
          if (trans?.main) result.translations.push(trans.main);
          if (trans?.bg) result.bgTranslations.push(trans.bg);
        } else if (role === Values.RoleRoman) {
          const roman = this.parseInlineSubContent(el);
          if (roman?.main) result.romanizations.push(roman.main);
          if (roman?.bg) result.bgRomanizations.push(roman.bg);
        } else {
          this.parseWordElement(el, result);
        }
      }
    }

    return result;
  }

  private parseRubyElement(containerEl: Element, state: ParsedNodeContent): void {
    const isObscene = getAttr(containerEl, "amll:obscene", "obscene") === "true";
    const emptyBeatStr = getAttr(containerEl, "amll:empty-beat", "empty-beat");
    const emptyBeat = emptyBeatStr ? parseInt(emptyBeatStr, 10) : undefined;

    let baseText = "";
    const rubyTags: { text: string; startTime: number; endTime: number }[] = [];

    for (const child of Array.from(containerEl.children)) {
      const childRuby = getAttr(child, "tts:ruby", "ruby");
      if (childRuby === Values.RubyBase) {
        baseText = this.normalizeText(child.textContent, false);
      } else if (childRuby === Values.RubyTextContainer) {
        for (const tNode of Array.from(child.children)) {
          const tAttr = getAttr(tNode, "tts:ruby", "ruby");
          if (tAttr === Values.RubyText) {
            const begin = getAttr(tNode, "begin");
            const end = getAttr(tNode, "end");
            const text = this.normalizeText(tNode.textContent, false).trim();
            if (text && begin && end) {
              rubyTags.push({
                text,
                startTime: this.parseTime(begin),
                endTime: this.parseTime(end),
              });
            }
          }
        }
      }
    }

    if (!baseText) return;
    state.fullText += baseText;

    let startTime = 0;
    let endTime = 0;
    if (rubyTags.length > 0) {
      startTime = Math.min(...rubyTags.map((t) => t.startTime));
      endTime = Math.max(...rubyTags.map((t) => t.endTime));
    }

    const cleanBase = baseText.trim();
    if (cleanBase.length > 0) {
      const endsWithSpace = TTMLParser.TRAILING_SPACE_REGEX.test(baseText);
      const startsWithSpace = TTMLParser.LEADING_SPACE_REGEX.test(baseText);

      if (startsWithSpace && state.words.length > 0) {
        state.words[state.words.length - 1].endsWithSpace = true;
      }

      state.words.push({
        text: cleanBase,
        startTime,
        endTime,
        ruby: rubyTags.length > 0 ? rubyTags : undefined,
        endsWithSpace,
        obscene: isObscene || undefined,
        emptyBeat: Number.isNaN(emptyBeat) ? undefined : emptyBeat,
      });
    }
  }

  private parseWordElement(el: Element, state: ParsedNodeContent): void {
    const begin = getAttr(el, "begin");
    const end = getAttr(el, "end");
    const isObscene = getAttr(el, "amll:obscene", "obscene") === "true";
    const emptyBeatStr = getAttr(el, "amll:empty-beat", "empty-beat");
    const emptyBeat = emptyBeatStr ? parseInt(emptyBeatStr, 10) : undefined;

    const raw = el.textContent || "";
    const normalized = this.normalizeText(raw, false);
    state.fullText += normalized;

    if (begin && end) {
      const isFormatting = raw.includes("\n");
      let startsWithSpace = false;
      let endsWithSpace = false;

      if (!isFormatting) {
        startsWithSpace = TTMLParser.LEADING_SPACE_REGEX.test(normalized);
        endsWithSpace = TTMLParser.TRAILING_SPACE_REGEX.test(normalized);
      }

      const cleanText = normalized.trim();

      if (startsWithSpace && state.words.length > 0) {
        state.words[state.words.length - 1].endsWithSpace = true;
      }

      if (cleanText.length > 0) {
        state.words.push({
          text: cleanText,
          startTime: this.parseTime(begin),
          endTime: this.parseTime(end),
          endsWithSpace,
          obscene: isObscene || undefined,
          emptyBeat: Number.isNaN(emptyBeat) ? undefined : emptyBeat,
        });
      }
    }
  }

  private parseBackgroundVocalElement(el: Element): BackgroundVocal {
    const parsed = this.parseNodeContent(el);
    const text = this.normalizeText(parsed.fullText)
      .replace(/^[(（]+/, "")
      .replace(/[)）]+$/, "");

    if (parsed.words.length > 0) {
      parsed.words[0].text = parsed.words[0].text.replace(/^[(（]+/, "").trimStart();
      const last = parsed.words[parsed.words.length - 1];
      last.text = last.text.replace(/[)）]+$/, "").trimEnd();
    }

    const beginAttr = getAttr(el, "begin");
    const endAttr = getAttr(el, "end");
    let startTime = this.parseTime(beginAttr);
    let endTime = this.parseTime(endAttr);

    if (startTime === 0 && parsed.words.length > 0) {
      startTime = Math.min(...parsed.words.map((w) => w.startTime));
    }
    if (endTime === 0 && parsed.words.length > 0) {
      endTime = Math.max(...parsed.words.map((w) => w.endTime));
    }

    return {
      text,
      startTime,
      endTime,
      words: parsed.words.length > 0 ? parsed.words : undefined,
      translations: parsed.translations.length > 0 ? parsed.translations : undefined,
      romanizations: parsed.romanizations.length > 0 ? parsed.romanizations : undefined,
    };
  }

  private parseInlineSubContent(
    el: Element,
  ): { main?: SubLyricContent; bg?: SubLyricContent } | null {
    const lang = getAttr(el, "xml:lang", "lang") || undefined;
    const parsed = this.parseNodeContent(el);

    const mainText = this.normalizeText(parsed.fullText);
    const hasMainWords = parsed.words.length > 0;
    const result: { main?: SubLyricContent; bg?: SubLyricContent } = {};

    if (mainText || hasMainWords) {
      result.main = {
        text: mainText,
        language: lang,
        words: hasMainWords ? parsed.words : undefined,
      };
    }

    if (parsed.backgroundVocal) {
      result.bg = {
        text: parsed.backgroundVocal.text,
        language: lang,
        words: parsed.backgroundVocal.words,
      };
    }

    return result.main || result.bg ? result : null;
  }
}
