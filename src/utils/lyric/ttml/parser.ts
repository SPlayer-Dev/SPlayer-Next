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
  ParseTTMLOptions,
  SubLyricContent,
  Syllable,
  TTMLMetadata,
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

interface TimedRange {
  startTime: number;
  endTime: number;
}

/**
 * 获取元素属性值，按候选名称顺序匹配第一个有效值
 * @param el - 目标 DOM 元素
 * @param names - 候选属性名列表
 * @returns 属性值或 null
 */
function getAttr(el: Element, ...names: string[]): string | null {
  for (const name of names) {
    const val = el.getAttribute(name);
    if (val !== null && val !== undefined) return val;
  }
  return null;
}

/**
 * 遍历直接子元素，获取匹配本地标签名的元素列表
 * @param parent - 父级元素或文档
 * @param localName - 目标本地标签名
 * @returns 匹配的子元素数组
 */
function getChildrenByLocalName(parent: Element | Document, localName: string): Element[] {
  const result: Element[] = [];
  const target = localName.toLowerCase();
  const children =
    parent instanceof Document
      ? parent.documentElement
        ? [parent.documentElement]
        : []
      : Array.from(parent.children);

  for (const child of children) {
    const current = (child.localName || child.tagName.split(":").pop() || "").toLowerCase();
    if (current === target) {
      result.push(child);
    }
  }
  return result;
}

/**
 * 查找匹配特定本地标签名的第一个直接子元素
 * @param parent - 父级元素或文档
 * @param localName - 目标本地标签名
 * @returns 匹配的第一个子元素或 undefined
 */
function getFirstChildByLocalName(
  parent: Element | Document,
  localName: string,
): Element | undefined {
  return getChildrenByLocalName(parent, localName)[0];
}

export class TTMLParser {
  private cleanKangxi: boolean;
  private stripBackgroundParens: boolean;

  private static readonly TIME_REGEX =
    /^(?:(?:(?<hours>\d+):)?(?<minutes>\d+):)?(?<seconds>\d+(?:\.\d+)?)$/;
  private static readonly LEADING_SPACE_REGEX = /^\s/;
  private static readonly TRAILING_SPACE_REGEX = /\s$/;
  private static readonly MULTI_SPACE_REGEX = /\s+/g;

  /**
   * 构造 TTML 解析器实例
   * @param options - 解析配置选项
   */
  constructor(options?: ParseTTMLOptions) {
    this.cleanKangxi = Boolean(options?.cleanKangxi);
    this.stripBackgroundParens = options?.stripBackgroundParens ?? true;
  }

  /**
   * 静态便捷解析入口
   * @param xmlStr - TTML XML 字符串
   * @param options - 解析配置选项
   * @returns 结构化 AST 结果
   */
  public static parse(xmlStr: string, options?: ParseTTMLOptions): TTMLResult {
    return new TTMLParser(options).parse(xmlStr);
  }

  /**
   * 解析 TTML XML 文本为结构化 AST
   * @param xmlStr - TTML XML 字符串
   * @returns 解析后的 TTMLResult
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

    const { metadata, sidecar } = this.parseHead(root);

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

    this.parseBody(root, result, sidecar);

    result.metadata.timingMode ??= this.inferTimingMode(result.lines);

    return result;
  }

  /**
   * 解析时间戳字符串为毫秒数值
   * @param timeStr - 包含时间格式的字符串
   * @returns 毫秒数值
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

  /**
   * 文本空白归一化处理
   * @param text - 待处理文本
   * @param trim - 是否去除首尾空白
   * @returns 归一化后的文本
   */
  private normalizeText(text: string | null | undefined, trim: boolean = true): string {
    if (!text) return "";
    const normalized = text.replace(TTMLParser.MULTI_SPACE_REGEX, " ");
    return trim ? normalized.trim() : normalized;
  }

  /**
   * 根据逐字音节判断当前歌词的计时模式
   * @param lines - 歌词行数组
   * @returns 计时模式 Word 或 Line
   */
  private inferTimingMode(lines: LyricLine[]): "Word" | "Line" {
    const hasWordTiming = lines.some(
      (line) => (line.words?.length ?? 0) > 1 || (line.backgroundVocal?.words?.length ?? 0) > 1,
    );
    return hasWordTiming ? "Word" : "Line";
  }

  /**
   * 解析 Head 节点中的元数据与 Sidecar 翻译音译
   * @param root - 根节点
   * @returns 元数据与 Sidecar 字典
   */
  private parseHead(root: Element): { metadata: TTMLMetadata; sidecar: SidecarStore } {
    const head = getFirstChildByLocalName(root, Elements.Head);
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

    const metadataContainer = getFirstChildByLocalName(head, Elements.TTMLMetadata);
    if (!metadataContainer) return { metadata, sidecar };

    // 提取标题
    const titles = getChildrenByLocalName(metadataContainer, Elements.Title);
    for (const titleEl of titles) {
      const t = titleEl.textContent?.trim();
      if (t) metadata.title?.push(t);
    }

    // 提取声部演唱者
    const agents = getChildrenByLocalName(metadataContainer, Elements.Agent);
    for (const agentEl of agents) {
      const id = getAttr(agentEl, "xml:id", "id");
      if (!id) continue;
      const type = getAttr(agentEl, "type") || undefined;
      const nameEl = getFirstChildByLocalName(agentEl, Elements.Name);
      const name = nameEl?.textContent?.trim() || undefined;

      const agentObj: Agent = { id };
      if (type) agentObj.type = type;
      if (name) agentObj.name = name;

      metadata.agents ??= {};
      metadata.agents[id] = agentObj;
    }

    // 提取 AMLL 扩展元数据
    const metas = getChildrenByLocalName(metadataContainer, Elements.Meta);
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

    // 提取 iTunesMetadata 扩展
    const iTunesMetas = getChildrenByLocalName(metadataContainer, Elements.ITunesMetadata);
    for (const itunes of iTunesMetas) {
      const songwritersContainer = getFirstChildByLocalName(itunes, Elements.Songwriters);
      if (songwritersContainer) {
        const writers = getChildrenByLocalName(songwritersContainer, Elements.Songwriter);
        for (const w of writers) {
          const name = w.textContent?.trim();
          if (name) metadata.songwriters?.push(name);
        }
      }

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

  /**
   * 解析 Sidecar 容器内的翻译或音译文本条目
   * @param container - iTunesMetadata 元素
   * @param groupTag - 容器组标签名
   * @param itemTag - 子项标签名
   * @param type - 存放类型
   * @param sidecar - 目标 Sidecar 容器
   */
  private parseSidecarEntries(
    container: Element,
    groupTag: string,
    itemTag: string,
    type: "translations" | "romanizations",
    sidecar: SidecarStore,
  ): void {
    const groups = getChildrenByLocalName(container, groupTag);
    for (const g of groups) {
      const items = getChildrenByLocalName(g, itemTag);
      for (const item of items) {
        const lang = getAttr(item, "xml:lang", "lang") || undefined;
        const textNodes = getChildrenByLocalName(item, Elements.Text);

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
   * 解析 Body 节点及段落行
   * @param root - 根节点
   * @param result - 目标结果容器
   * @param sidecar - Sidecar 数据源
   */
  private parseBody(root: Element, result: TTMLResult, sidecar: SidecarStore): void {
    const body = getFirstChildByLocalName(root, Elements.Body);
    if (!body) return;

    let currentBlockIndex = 0;

    for (const node of Array.from(body.children)) {
      const tagName = (node.localName || node.tagName.split(":").pop() || "").toLowerCase();

      if (tagName === Elements.Div) {
        currentBlockIndex++;
        const songPart =
          getAttr(node, "itunes:song-part", "itunes:songPart", "song-part", "songPart") ||
          undefined;
        const pList = getChildrenByLocalName(node, Elements.P);

        for (const p of pList) {
          this.processLineElement(p, result.lines, sidecar, songPart, currentBlockIndex);
        }
      } else if (tagName === Elements.P) {
        currentBlockIndex++;
        this.processLineElement(node, result.lines, sidecar, undefined, currentBlockIndex);
      }
    }
  }

  /**
   * 处理单行 p 元素
   * @param p - p 节点
   * @param lines - 目标行列表
   * @param sidecar - Sidecar 数据源
   * @param songPart - 歌曲段落结构
   * @param blockIndex - 分块序号
   */
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

    let startTime = originalStartTime;
    let endTime = originalEndTime;
    const timedElements: TimedRange[] = [...parsed.words];
    if (parsed.backgroundVocal) {
      timedElements.push(parsed.backgroundVocal);
    }

    if (timedElements.length > 0) {
      let minStart = Infinity;
      let maxEnd = 0;
      for (const el of timedElements) {
        if (el.startTime < minStart) minStart = el.startTime;
        if (el.endTime > maxEnd) maxEnd = el.endTime;
      }
      // 仅当标签未显式声明 begin 时，才以子音节最小起始时间兜底
      if (beginAttr === null) {
        startTime = minStart === Infinity ? 0 : minStart;
      }
      // 仅当标签未显式声明 end 时以最大结束时间兜底，或子音节超出当前 end 时进行扩充
      if (endAttr === null) {
        endTime = maxEnd;
      } else if (maxEnd > endTime) {
        endTime = maxEnd;
      }
    }

    const cleanFullText = this.normalizeText(parsed.fullText);

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

    if (parsed.words.length > 0) {
      parsed.words[0].text = parsed.words[0].text.trimStart();
      const last = parsed.words[parsed.words.length - 1];
      last.text = last.text.trimEnd();
      last.endsWithSpace = false;
    }

    const bgVocal = parsed.backgroundVocal;
    if (bgVocal) {
      if (bgVocal.startTime === 0 && bgVocal.words?.length) {
        bgVocal.startTime = Math.min(...bgVocal.words.map((w) => w.startTime));
      }
      if (bgVocal.endTime === 0 && bgVocal.words?.length) {
        bgVocal.endTime = Math.max(...bgVocal.words.map((w) => w.endTime));
      }
      if (bgVocal.startTime === 0 && startTime > 0) bgVocal.startTime = startTime;
      if (bgVocal.endTime === 0 && endTime > 0) bgVocal.endTime = endTime;

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
   * @param element - 当前 DOM 元素
   * @returns 解析后的内容容器
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

  /**
   * 解析 Ruby 振假名注音节点
   * @param containerEl - 包含注音的容器元素
   * @param state - 内容状态容器
   */
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

  /**
   * 解析普通逐字音节节点
   * @param el - span 节点
   * @param state - 内容状态容器
   */
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

  /**
   * 解析背景伴唱节点
   * @param el - 伴唱节点
   * @returns 背景伴唱对象
   */
  private parseBackgroundVocalElement(el: Element): BackgroundVocal {
    const parsed = this.parseNodeContent(el);
    let text = this.normalizeText(parsed.fullText);
    if (this.stripBackgroundParens) {
      text = text.replace(/^[(（]+/, "").replace(/[)）]+$/, "");
    }

    if (parsed.words.length > 0 && this.stripBackgroundParens) {
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

  /**
   * 解析行内翻译或音译节点
   * @param el - 包含角色的 span 节点
   * @returns 翻译音译片段
   */
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
