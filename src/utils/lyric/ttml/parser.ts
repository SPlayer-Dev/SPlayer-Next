/**
 * TTML 歌词解析器核心实现
 * 负责将符合 Apple Music / AMLL 规范的 TTML XML 解析为结构化 AST
 */

import { normalizeKangxi } from "lyric-kit";
import { Attributes, Elements, NodeType, NS, QualifiedAttributes, Values } from "./constants";
import type {
  Agent,
  BackgroundVocal,
  LyricBase,
  LyricLine,
  MinimalDOMParser,
  MinimalElement,
  MinimalNode,
  PlatformId,
  SubLyricContent,
  Syllable,
  TTMLMetadata,
  TTMLParserOptions,
  TTMLResult,
} from "./types";

/** 用于关联 Sidecar 翻译/音译与主歌词行的临时映射容器 */
interface ExtensionSidecar {
  [lineId: string]: {
    translations?: SubLyricContent[];
    romanizations?: SubLyricContent[];
    bgTranslations?: SubLyricContent[];
    bgRomanizations?: SubLyricContent[];
  };
}

interface ParsedNodeState {
  fullText: string;
  words: Syllable[];
  translations: SubLyricContent[];
  romanizations: SubLyricContent[];
  bgTranslations: SubLyricContent[];
  bgRomanizations: SubLyricContent[];
  backgroundVocal?: BackgroundVocal;
}

export class TTMLParser {
  private domParser: MinimalDOMParser;
  private cleanKangxi: boolean;

  private static readonly TIME_REGEX =
    /^(?:(?:(?<hours>\d+):)?(?<minutes>\d+):)?(?<seconds>\d+(?:\.\d+)?)$/;
  private static readonly LEADING_SPACE_REGEX = /^\s/;
  private static readonly TRAILING_SPACE_REGEX = /\s$/;
  private static readonly MULTI_SPACE_REGEX = /\s+/g;

  /**
   * 构造 TTML 解析器实例
   * @param options - 解析配置选项，在 Node 环境可注入 domParser
   */
  constructor(options?: TTMLParserOptions) {
    this.cleanKangxi = Boolean(options?.cleanKangxi);
    if (options?.domParser) {
      this.domParser = options.domParser;
    } else if (typeof DOMParser !== "undefined") {
      this.domParser = new DOMParser() as unknown as MinimalDOMParser;
    } else {
      throw new Error(
        "No DOMParser found. If you are running in Node.js, please inject a DOMParser.",
      );
    }
  }

  /**
   * 文本空白归一化
   * @param text - 待处理文本
   * @param trim - 是否去除首尾空白
   * @returns 归一化文本
   */
  private normalizeText(text: string | null | undefined, trim: boolean = true): string {
    if (!text) return "";
    const normalized = text.replace(TTMLParser.MULTI_SPACE_REGEX, " ");
    return trim ? normalized.trim() : normalized;
  }

  /**
   * 解析 TTML 字符串的静态便捷方法
   * @param xmlStr - TTML XML 字符串
   * @param options - 解析配置选项
   * @returns 解析后的 TTMLResult AST
   */
  public static parse(xmlStr: string, options?: TTMLParserOptions): TTMLResult {
    const instance = new TTMLParser(options);
    return instance.parse(xmlStr);
  }

  /**
   * 解析 TTML XML 文本为结构化 AST
   * @param xmlStr - TTML XML 字符串
   * @returns 解析后的 TTMLResult
   */
  public parse(xmlStr: string): TTMLResult {
    if (!xmlStr || typeof xmlStr !== "string") {
      throw new Error("TTMLParser: Input must be a valid XML string.");
    }

    const preparedXml = this.cleanKangxi ? normalizeKangxi(xmlStr) : xmlStr;
    const doc = this.domParser.parseFromString(preparedXml, Values.MimeXML);

    const parserErrors = this.findElementsByLocalName(doc, Elements.ParserError);
    if (parserErrors.length > 0 && parserErrors[0]) {
      throw new Error(`TTMLParser: XML parsing error: ${parserErrors[0].textContent}`);
    }

    const { metadata, sidecar } = this.parseHead(doc);

    const result: TTMLResult = {
      metadata,
      lines: [],
    };

    const root = doc.documentElement;
    if (root) {
      const lang = this.getAttr(root, NS.XML, Attributes.Lang, QualifiedAttributes.XmlLang);
      if (lang) {
        result.metadata.language = lang;
      }

      const timing = this.getAttr(
        root,
        NS.ITUNES,
        Attributes.Timing,
        QualifiedAttributes.ITunesTiming,
      );
      if (timing === Values.Word || timing === Values.Line) {
        result.metadata.timingMode = timing;
      }
    }

    this.parseBody(doc, result, sidecar);

    result.metadata.timingMode ??= this.inferTimingMode(result.lines);

    if (result.metadata.platformIds) {
      result.metadata.platformIds = this.sortPlatformIds(result.metadata.platformIds);
    }

    return result;
  }

  /**
   * 按照本地标签名查找子元素（兼顾浏览器与 happy-dom 跨环境表现）
   * @param root - 根元素或文档节点
   * @param targetLocalName - 目标本地名称
   * @param ns - 可选的命名空间
   * @returns 匹配的元素列表
   */
  private findElementsByLocalName(
    root: MinimalNode | MinimalElement,
    targetLocalName: string,
    ns?: string,
  ): MinimalElement[] {
    const el = root as MinimalElement;
    if (!el.getElementsByTagName) return [];

    const byTag = el.getElementsByTagName(targetLocalName);
    const byTagList = Array.from(byTag as Iterable<MinimalElement>);
    if (byTagList.length > 0) return byTagList;

    if (ns && el.getElementsByTagNameNS) {
      const byNS = el.getElementsByTagNameNS(ns, targetLocalName);
      const byNSList = Array.from(byNS as Iterable<MinimalElement>);
      if (byNSList.length > 0) return byNSList;
    }

    const all = el.getElementsByTagName("*");
    const allList = Array.from(all as Iterable<MinimalElement>);
    const targetLower = targetLocalName.toLowerCase();
    const matched: MinimalElement[] = [];

    for (const item of allList) {
      const local = (item.localName || item.tagName?.split(":").pop())?.toLowerCase();
      if (local === targetLower) {
        matched.push(item);
      }
    }

    return matched;
  }

  /**
   * 命名空间与属性获取辅助函数
   * @param element - 当前 DOM 元素
   * @param ns - 属性命名空间
   * @param localName - 属性本地名
   * @param fallbackAttrName - 可选回退属性名
   * @returns 属性值或 null
   */
  private getAttr(
    element: MinimalElement,
    ns: string,
    localName: string,
    fallbackAttrName?: string,
  ): string | null {
    if (fallbackAttrName) {
      const fallbackVal = element.getAttribute(fallbackAttrName);
      if (fallbackVal !== null && fallbackVal !== undefined) return fallbackVal;
    }

    const direct = element.getAttribute(localName);
    if (direct !== null && direct !== undefined) return direct;

    if (element.getAttributeNS) {
      const val = element.getAttributeNS(ns, localName);
      if (val !== null && val !== undefined) return val;
    }

    if (element.attributes) {
      const attrs = Array.from(element.attributes as Iterable<MinimalNode>);
      const targetLower = localName.toLowerCase();
      for (const attr of attrs) {
        const attrName =
          (attr as unknown as { name?: string; nodeName?: string }).name || attr.nodeName || "";
        const attrLocal = (attr.localName || attrName.split(":").pop())?.toLowerCase();
        if (attrLocal === targetLower) {
          return (attr as unknown as { value: string }).value;
        }
      }
    }

    return null;
  }

  /**
   * 根据逐字时间戳自动推断计时模式
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
   * 对各音乐平台的 ID 字典按常用优先级排序
   * @param platformIds - 平台 ID 字典
   * @returns 排序后的平台 ID 字典
   */
  private sortPlatformIds(platformIds: Record<string, string[]>): Record<string, string[]> {
    const preferredOrder = ["ncmMusicId", "qqMusicId", "spotifyId", "appleMusicId"];

    const orderedPlatformIds: Record<string, string[]> = {};

    for (const key of preferredOrder) {
      if (platformIds[key]) {
        orderedPlatformIds[key] = platformIds[key];
      }
    }

    for (const key of Object.keys(platformIds)) {
      if (!orderedPlatformIds[key] && platformIds[key]) {
        orderedPlatformIds[key] = platformIds[key];
      }
    }

    return orderedPlatformIds;
  }

  /**
   * 解析 Head 元素中的元数据与 Sidecar 翻译/音译
   * @param doc - DOM 文档对象
   * @returns 元数据与 Sidecar 映射
   */
  private parseHead(doc: MinimalNode): {
    metadata: TTMLMetadata;
    sidecar: ExtensionSidecar;
  } {
    const head = this.findElementsByLocalName(doc, Elements.Head)[0];

    const resultMeta: TTMLMetadata = {
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
    const sidecar: ExtensionSidecar = {};

    if (!head) {
      return { metadata: resultMeta, sidecar };
    }

    this.parseTTMElements(head, resultMeta);
    this.parseAMLLMeta(head, resultMeta);
    this.parseiTunesExtensions(head, resultMeta, sidecar);
    this.deduplicateMetadata(resultMeta);

    return { metadata: resultMeta, sidecar };
  }

  /**
   * 去重元数据中的数组项
   * @param meta - 元数据对象
   */
  private deduplicateMetadata(meta: TTMLMetadata): void {
    const dedupe = (arr?: string[]): string[] => (arr ? Array.from(new Set(arr)) : []);

    meta.title = dedupe(meta.title);
    meta.artist = dedupe(meta.artist);
    meta.album = dedupe(meta.album);
    meta.isrc = dedupe(meta.isrc);
    meta.authorIds = dedupe(meta.authorIds);
    meta.authorNames = dedupe(meta.authorNames);
    meta.songwriters = dedupe(meta.songwriters);

    if (meta.platformIds) {
      for (const key of Object.keys(meta.platformIds) as PlatformId[]) {
        if (meta.platformIds[key]) {
          meta.platformIds[key] = dedupe(meta.platformIds[key]);
        }
      }
    }

    if (meta.rawProperties) {
      for (const key of Object.keys(meta.rawProperties)) {
        if (meta.rawProperties[key]) {
          meta.rawProperties[key] = dedupe(meta.rawProperties[key]);
        }
      }
    }
  }

  /**
   * 解析 TTM 命名空间标签（标题与演唱者）
   * @param head - Head 元素
   * @param meta - 元数据对象
   */
  private parseTTMElements(head: MinimalElement, meta: TTMLMetadata): void {
    const titles = this.findElementsByLocalName(head, Elements.Title, NS.TTM);
    if (titles.length > 0 && titles[0].textContent) {
      meta.title?.push(titles[0].textContent.trim());
    }

    const agents = this.findElementsByLocalName(head, Elements.Agent, NS.TTM);

    for (const agent of agents) {
      const id = this.getAttr(agent, NS.XML, Attributes.Id, QualifiedAttributes.XmlId);
      if (!id) continue;

      const type = this.getAttr(agent, NS.TTM, Attributes.Type, Attributes.Type);
      const names = this.findElementsByLocalName(agent, Elements.Name, NS.TTM);

      const agentObj: Agent = { id };
      if (type) agentObj.type = type;

      if (names.length > 0 && names[0].textContent) {
        const rawName = names[0].textContent.trim();
        if (rawName.length > 0) agentObj.name = rawName;
      }

      meta.agents ??= {};
      meta.agents[id] = agentObj;
    }
  }

  /**
   * 解析 AMLL 扩展元数据标签
   * @param head - Head 元素
   * @param meta - 元数据对象
   */
  private parseAMLLMeta(head: MinimalElement, meta: TTMLMetadata): void {
    const metas = this.findElementsByLocalName(head, Elements.Meta, NS.AMLL);

    const validMetas = metas.filter(
      (el) =>
        this.getAttr(el, NS.AMLL, Attributes.Key, Attributes.Key) &&
        this.getAttr(el, NS.AMLL, Attributes.Value, Attributes.Value),
    );

    for (const el of validMetas) {
      const key = this.getAttr(el, NS.AMLL, Attributes.Key, Attributes.Key);
      const value = this.getAttr(el, NS.AMLL, Attributes.Value, Attributes.Value)?.trim();
      if (!key || !value) continue;

      switch (key) {
        case Values.MusicName:
          meta.title?.push(value);
          break;
        case Values.Artists:
          meta.artist?.push(value);
          break;
        case Values.Album:
          meta.album?.push(value);
          break;
        case Values.ISRC:
          meta.isrc?.push(value);
          break;
        case Values.TTMLAuthorGithub:
          meta.authorIds?.push(value);
          break;
        case Values.TTMLAuthorGithubLogin:
          meta.authorNames?.push(value);
          break;
        case Values.NCMMusicId:
        case Values.QQMusicId:
        case Values.SpotifyId:
        case Values.AppleMusicId:
          meta.platformIds ??= {};
          (meta.platformIds[key] ??= []).push(value);
          break;
        default:
          meta.rawProperties ??= {};
          (meta.rawProperties[key] ??= []).push(value);
          break;
      }
    }
  }

  /**
   * 提取辅助内容（翻译与音译片段）
   * @param base - 歌词基础片段
   * @param lang - 语言代码
   * @param ignoreWords - 是否忽略逐字音节
   * @returns 提取结果
   */
  private extractSubContent(
    base: LyricBase | BackgroundVocal,
    lang: string | null,
    ignoreWords: boolean = false,
  ): { main?: SubLyricContent; bg?: SubLyricContent } {
    const result: { main?: SubLyricContent; bg?: SubLyricContent } = {};
    const mainText = this.normalizeText(base.text);
    const hasMainWords = !ignoreWords && base.words && base.words.length > 0;

    if (mainText || hasMainWords) {
      const main: SubLyricContent = { text: mainText };
      if (lang) main.language = lang;

      if (hasMainWords) {
        const isZeroFallback =
          base.words?.length === 1 &&
          base.words?.[0].startTime === 0 &&
          base.words?.[0].endTime === 0;
        if (!isZeroFallback) main.words = base.words;
      }
      result.main = main;
    }

    if ("backgroundVocal" in base && base.backgroundVocal) {
      const bgVocal = base.backgroundVocal;
      const bgText = this.normalizeText(bgVocal.text);
      const hasBgWords = !ignoreWords && bgVocal.words && bgVocal.words.length > 0;

      if (bgText || hasBgWords) {
        const bg: SubLyricContent = { text: bgText };
        if (lang) bg.language = lang;

        if (hasBgWords) {
          const isZeroFallback =
            bgVocal.words?.length === 1 &&
            bgVocal.words?.[0].startTime === 0 &&
            bgVocal.words?.[0].endTime === 0;
          if (!isZeroFallback) bg.words = bgVocal.words;
        }
        result.bg = bg;
      }
    }

    return result;
  }

  /**
   * 解析 iTunesMetadata 扩展（词曲作者与 Sidecar 多语言翻译/音译）
   * @param head - Head 元素
   * @param meta - 元数据对象
   * @param sidecar - Sidecar 映射
   */
  private parseiTunesExtensions(
    head: MinimalElement,
    meta: TTMLMetadata,
    sidecar: ExtensionSidecar,
  ): void {
    const iTunesMetas = this.findElementsByLocalName(head, Elements.ITunesMetadata);
    if (iTunesMetas.length === 0) return;

    for (const iTunesMeta of iTunesMetas) {
      const songwritersContainers = this.findElementsByLocalName(iTunesMeta, Elements.Songwriters);
      if (songwritersContainers.length > 0) {
        const writers = this.findElementsByLocalName(songwritersContainers[0], Elements.Songwriter);
        for (const writer of writers) {
          const name = writer.textContent?.trim();
          if (name) meta.songwriters?.push(name);
        }
      }

      const processEntries = (
        containerTagName: string,
        itemTagName: string,
        type: "translations" | "romanizations",
      ): void => {
        const containers = this.findElementsByLocalName(iTunesMeta, containerTagName);
        if (containers.length === 0) return;

        for (const container of containers) {
          const items = this.findElementsByLocalName(container, itemTagName);
          for (const item of items) {
            const lang = this.getAttr(item, NS.XML, Attributes.Lang, QualifiedAttributes.XmlLang);
            const textNodes = this.findElementsByLocalName(item, Elements.Text);

            for (const textNode of textNodes) {
              const forId = this.getAttr(textNode, "", Attributes.For, Attributes.For);
              const parsedContent = this.parseCommonContent(textNode);

              if (forId) {
                const subContents = this.extractSubContent(parsedContent, lang, false);
                sidecar[forId] ??= {};

                if (subContents.main) {
                  (sidecar[forId][type] ??= []).push(subContents.main);
                }

                if (subContents.bg) {
                  const bgType = type === "translations" ? "bgTranslations" : "bgRomanizations";
                  (sidecar[forId][bgType] ??= []).push(subContents.bg);
                }
              }
            }
          }
        }
      };

      processEntries(Elements.Translations, Elements.Translation, "translations");
      processEntries(Elements.Transliterations, Elements.Transliteration, "romanizations");
    }
  }

  /**
   * 解析时间字符串为毫秒数值
   * @param timeStr - 时间格式字符串（如 01:23.456 或 83.456s）
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
        const totalSeconds = hrNum * 3600 + minNum * 60 + secNum;
        return Math.round(totalSeconds * 1000);
      }
    }

    return 0;
  }

  /**
   * 解析 Body 元素中的段落结构与歌词行
   * @param doc - DOM 文档对象
   * @param result - 目标结果对象
   * @param sidecar - Sidecar 映射
   */
  private parseBody(doc: MinimalNode, result: TTMLResult, sidecar: ExtensionSidecar): void {
    const bodies = this.findElementsByLocalName(doc, Elements.Body);
    const body = bodies[0];
    if (!body) return;

    const childNodes = Array.from(body.childNodes as Iterable<MinimalNode>);
    let currentBlockIndex = 0;

    for (const node of childNodes) {
      if (node.nodeType !== NodeType.ELEMENT_NODE) continue;
      const el = node as MinimalElement;
      const tagName = (
        el.localName ||
        el.tagName?.toLowerCase().split(":").pop() ||
        ""
      ).toLowerCase();

      if (tagName === Elements.Div) {
        currentBlockIndex++;
        const songPart =
          this.getAttr(el, NS.ITUNES, Attributes.SongPartKebab, "itunes:song-part") ||
          this.getAttr(el, NS.ITUNES, Attributes.SongPart, QualifiedAttributes.ITunesPart) ||
          this.getAttr(el, "", "song-part") ||
          this.getAttr(el, "", "songPart");

        const pList = this.findElementsByLocalName(el, Elements.P, NS.TT);

        for (const p of pList) {
          this.processLineElement(p, result.lines, sidecar, songPart, currentBlockIndex);
        }
      } else if (tagName === Elements.P) {
        currentBlockIndex++;
        this.processLineElement(el, result.lines, sidecar, undefined, currentBlockIndex);
      }
    }
  }

  /**
   * 解析单行 p 元素并合并外部 Sidecar 数据
   * @param p - p 元素
   * @param lines - 目标歌词行列表
   * @param sidecar - Sidecar 映射
   * @param songPart - 歌曲结构分段
   * @param blockIndex - 结构块序号
   */
  private processLineElement(
    p: MinimalElement,
    lines: LyricLine[],
    sidecar: ExtensionSidecar,
    songPart?: string | null,
    blockIndex?: number,
  ): void {
    const id =
      this.getAttr(p, NS.ITUNES, Attributes.Key, QualifiedAttributes.ITunesKey) ||
      p.getAttribute("id") ||
      `L${lines.length + 1}`;

    const baseContent = this.parseCommonContent(p);

    const line: LyricLine = {
      id,
      ...baseContent,
    };

    if (songPart) line.songPart = songPart;
    if (blockIndex !== undefined) line.blockIndex = blockIndex;

    const agentId = this.getAttr(p, NS.TTM, Elements.Agent, QualifiedAttributes.TTMAgent);
    if (agentId) line.agentId = agentId;

    const externalData = sidecar[id];
    if (externalData) {
      if (externalData.translations) {
        (line.translations ??= []).push(...externalData.translations);
      }
      if (externalData.romanizations) {
        (line.romanizations ??= []).push(...externalData.romanizations);
      }
      if (externalData.bgTranslations && line.backgroundVocal) {
        (line.backgroundVocal.translations ??= []).push(...externalData.bgTranslations);
      }
      if (externalData.bgRomanizations && line.backgroundVocal) {
        (line.backgroundVocal.romanizations ??= []).push(...externalData.bgRomanizations);
      }
    }

    lines.push(line);
  }

  /**
   * 递归解析元素节点的内容、逐字时间戳、内嵌角色与背景人声
   * @param element - 当前 DOM 元素
   * @returns 基础歌词对象
   */
  private parseCommonContent(element: MinimalElement): LyricBase {
    const beginAttr = this.getAttr(element, NS.XML, Attributes.Begin, Attributes.Begin);
    const endAttr = this.getAttr(element, NS.XML, Attributes.End, Attributes.End);
    const originalStartTime = this.parseTime(beginAttr);
    const originalEndTime = this.parseTime(endAttr);

    const state = this.extractNodeState(element);

    if (state.backgroundVocal) {
      // 实施层级时间戳兜底：自身属性 -> 子 words min/max -> 父节点 begin/end
      if (!state.backgroundVocal.startTime && state.backgroundVocal.words?.length) {
        state.backgroundVocal.startTime = Math.min(
          ...state.backgroundVocal.words.map((w) => w.startTime),
        );
      }
      if (!state.backgroundVocal.endTime && state.backgroundVocal.words?.length) {
        state.backgroundVocal.endTime = Math.max(
          ...state.backgroundVocal.words.map((w) => w.endTime),
        );
      }
      if (!state.backgroundVocal.startTime && originalStartTime > 0) {
        state.backgroundVocal.startTime = originalStartTime;
      }
      if (!state.backgroundVocal.endTime && originalEndTime > 0) {
        state.backgroundVocal.endTime = originalEndTime;
      }

      if (state.bgTranslations.length > 0) {
        (state.backgroundVocal.translations ??= []).push(...state.bgTranslations);
      }
      if (state.bgRomanizations.length > 0) {
        (state.backgroundVocal.romanizations ??= []).push(...state.bgRomanizations);
      }
    }

    this.finalizeWords(state.words);

    const { startTime, endTime } = this.calculateTimeRange(
      originalStartTime,
      originalEndTime,
      state.words,
      state.backgroundVocal,
    );

    const cleanFullText = this.normalizeText(state.fullText);
    const hasTimeAttrs = beginAttr !== null || endAttr !== null;
    this.applyFallbackWord(
      state.words,
      cleanFullText,
      hasTimeAttrs,
      originalStartTime,
      originalEndTime,
      startTime,
      endTime,
    );

    return this.buildLyricBase(state, cleanFullText, startTime, endTime);
  }

  /**
   * 提取当前节点下所有子节点状态
   * @param element - 当前 DOM 元素
   * @returns 提取的临时节点状态
   */
  private extractNodeState(element: MinimalElement): ParsedNodeState {
    const state: ParsedNodeState = {
      fullText: "",
      words: [],
      translations: [],
      romanizations: [],
      bgTranslations: [],
      bgRomanizations: [],
      backgroundVocal: undefined,
    };

    const childNodes = Array.from(element.childNodes as Iterable<MinimalNode>);
    for (const node of childNodes) {
      if (node.nodeType === NodeType.TEXT_NODE) {
        this.processTextNode(state, node);
      } else if (node.nodeType === NodeType.ELEMENT_NODE) {
        this.processElementNode(state, node as MinimalElement);
      }
    }

    return state;
  }

  /**
   * 计算节点真实的起止时间范围
   * @param originalStart - 标签自身开始时间
   * @param originalEnd - 标签自身结束时间
   * @param words - 逐字音节列表
   * @param bgVocal - 背景人声对象
   * @returns 计算后的起止时间
   */
  private calculateTimeRange(
    originalStart: number,
    originalEnd: number,
    words: Syllable[],
    bgVocal?: BackgroundVocal,
  ): { startTime: number; endTime: number } {
    let startTime = originalStart;
    let endTime = originalEnd;

    const timedElements: (Syllable | BackgroundVocal)[] = [...words];
    if (bgVocal) timedElements.push(bgVocal);

    if (timedElements.length > 0) {
      let minChildStart = Infinity;
      let maxChildEnd = 0;

      for (const el of timedElements) {
        if (el.startTime < minChildStart) minChildStart = el.startTime;
        if (el.endTime > maxChildEnd) maxChildEnd = el.endTime;
      }

      if (startTime === 0 || (minChildStart > 0 && minChildStart < startTime)) {
        startTime = minChildStart === Infinity ? 0 : minChildStart;
      }

      if (endTime === 0 || maxChildEnd > endTime) {
        endTime = maxChildEnd;
      }
    }

    return { startTime, endTime };
  }

  /**
   * 无逐字音节但存在文本时的单字音节兜底
   */
  private applyFallbackWord(
    words: Syllable[],
    cleanText: string,
    hasTimeAttrs: boolean,
    origStart: number,
    origEnd: number,
    calcStart: number,
    calcEnd: number,
  ): void {
    if (words.length === 0 && cleanText.length > 0 && hasTimeAttrs) {
      words.push({
        text: cleanText,
        startTime: origStart > 0 ? origStart : calcStart,
        endTime: origEnd > 0 ? origEnd : calcEnd,
        endsWithSpace: false,
      });
    }
  }

  /**
   * 组装 LyricBase 对象
   */
  private buildLyricBase(
    state: ParsedNodeState,
    cleanText: string,
    startTime: number,
    endTime: number,
  ): LyricBase {
    return {
      text: cleanText,
      startTime,
      endTime,
      words: state.words.length > 0 ? state.words : undefined,
      translations: state.translations.length > 0 ? state.translations : undefined,
      romanizations: state.romanizations.length > 0 ? state.romanizations : undefined,
      backgroundVocal: state.backgroundVocal,
    };
  }

  /**
   * 处理文本节点
   */
  private processTextNode(state: ParsedNodeState, node: MinimalNode): void {
    const rawText = node.textContent || "";
    const isFormatting = rawText.includes("\n");
    if (isFormatting && rawText.trim().length === 0) return;

    const normalizedText = this.normalizeText(rawText, false);
    state.fullText += normalizedText;

    if (!isFormatting && normalizedText.length > 0 && normalizedText.trim().length === 0) {
      if (state.words.length > 0) {
        state.words[state.words.length - 1].endsWithSpace = true;
      }
    }
  }

  /**
   * 处理元素节点（Ruby、背景人声、翻译、普通单词）
   */
  private processElementNode(state: ParsedNodeState, el: MinimalElement): void {
    const role = this.getAttr(el, NS.TTM, Attributes.Role, QualifiedAttributes.TTMRole);
    const rubyAttr = this.getAttr(el, NS.TTS, Attributes.Ruby, QualifiedAttributes.TtsRuby);

    if (rubyAttr === Values.RubyContainer) {
      this.processRubyElement(state, el);
      return;
    }

    switch (role) {
      case Values.RoleBg:
        state.backgroundVocal = this.parseBackgroundVocal(el);
        break;
      case Values.RoleTranslation: {
        const translation = this.parseInlineSubContent(el);
        if (translation) {
          if (translation.main) state.translations.push(translation.main);
          if (translation.bg) state.bgTranslations.push(translation.bg);
        }
        break;
      }
      case Values.RoleRoman: {
        const romanization = this.parseInlineSubContent(el);
        if (romanization) {
          if (romanization.main) state.romanizations.push(romanization.main);
          if (romanization.bg) state.bgRomanizations.push(romanization.bg);
        }
        break;
      }
      default:
        this.processWordElement(state, el);
        break;
    }
  }

  /**
   * 解析 Ruby 注音容器节点
   */
  private processRubyElement(state: ParsedNodeState, containerEl: MinimalElement): void {
    const obsceneAttr = this.getAttr(
      containerEl,
      NS.AMLL,
      Attributes.Obscene,
      QualifiedAttributes.AmllObscene,
    );
    const isObscene = obsceneAttr === "true";

    const emptyBeatAttr = this.getAttr(
      containerEl,
      NS.AMLL,
      Attributes.EmptyBeat,
      QualifiedAttributes.AmllEmptyBeat,
    );
    let emptyBeat: number | undefined;
    if (emptyBeatAttr) {
      const parsedBeat = parseInt(emptyBeatAttr, 10);
      if (!Number.isNaN(parsedBeat)) emptyBeat = parsedBeat;
    }

    let baseText = "";
    const rubyTags: { text: string; startTime: number; endTime: number }[] = [];
    const childNodes = Array.from(containerEl.childNodes as Iterable<MinimalNode>);

    for (const node of childNodes) {
      if (node.nodeType !== NodeType.ELEMENT_NODE) continue;
      const childEl = node as MinimalElement;
      const childRubyAttr = this.getAttr(
        childEl,
        NS.TTS,
        Attributes.Ruby,
        QualifiedAttributes.TtsRuby,
      );

      if (childRubyAttr === Values.RubyBase) {
        baseText = this.normalizeText(childEl.textContent, false);
      } else if (childRubyAttr === Values.RubyTextContainer) {
        const textNodes = Array.from(childEl.childNodes as Iterable<MinimalNode>);
        for (const textNode of textNodes) {
          if (textNode.nodeType !== NodeType.ELEMENT_NODE) continue;
          const tNode = textNode as MinimalElement;
          const tAttr = this.getAttr(tNode, NS.TTS, Attributes.Ruby, QualifiedAttributes.TtsRuby);

          if (tAttr === Values.RubyText) {
            const begin = this.getAttr(tNode, NS.XML, Attributes.Begin, Attributes.Begin);
            const end = this.getAttr(tNode, NS.XML, Attributes.End, Attributes.End);
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

    const cleanBaseText = baseText.trim();
    if (cleanBaseText.length > 0) {
      const endsWithSpace = TTMLParser.TRAILING_SPACE_REGEX.test(baseText);
      const startsWithSpace = TTMLParser.LEADING_SPACE_REGEX.test(baseText);

      if (startsWithSpace && state.words.length > 0) {
        state.words[state.words.length - 1].endsWithSpace = true;
      }

      state.words.push({
        text: cleanBaseText,
        startTime,
        endTime,
        ruby: rubyTags.length > 0 ? rubyTags : undefined,
        endsWithSpace,
        obscene: isObscene ? true : undefined,
        emptyBeat,
      });
    }
  }

  /**
   * 解析普通单词 span 元素
   */
  private processWordElement(state: ParsedNodeState, el: MinimalElement): void {
    const wBegin = this.getAttr(el, NS.XML, Attributes.Begin, Attributes.Begin);
    const wEnd = this.getAttr(el, NS.XML, Attributes.End, Attributes.End);

    const obsceneAttr = this.getAttr(
      el,
      NS.AMLL,
      Attributes.Obscene,
      QualifiedAttributes.AmllObscene,
    );
    const isObscene = obsceneAttr === "true";

    const emptyBeatAttr = this.getAttr(
      el,
      NS.AMLL,
      Attributes.EmptyBeat,
      QualifiedAttributes.AmllEmptyBeat,
    );
    let emptyBeat: number | undefined;
    if (emptyBeatAttr) {
      const parsedBeat = parseInt(emptyBeatAttr, 10);
      if (!Number.isNaN(parsedBeat)) emptyBeat = parsedBeat;
    }

    const rawWText = el.textContent || "";
    const normalizedWText = this.normalizeText(rawWText, false);
    state.fullText += normalizedWText;

    if (wBegin && wEnd) {
      const isFormatting = rawWText.includes("\n");
      let startsWithSpace = false;
      let endsWithSpace = false;

      if (!isFormatting) {
        startsWithSpace = TTMLParser.LEADING_SPACE_REGEX.test(normalizedWText);
        endsWithSpace = TTMLParser.TRAILING_SPACE_REGEX.test(normalizedWText);
      }

      const cleanText = normalizedWText.trim();

      if (startsWithSpace && state.words.length > 0) {
        state.words[state.words.length - 1].endsWithSpace = true;
      }

      if (cleanText.length > 0) {
        state.words.push({
          text: cleanText,
          startTime: this.parseTime(wBegin),
          endTime: this.parseTime(wEnd),
          endsWithSpace,
          obscene: isObscene ? true : undefined,
          emptyBeat,
        });
      }
    }
  }

  /**
   * 解析背景人声并自动清洗首尾括号
   */
  private parseBackgroundVocal(el: MinimalElement): BackgroundVocal {
    const parsed = this.parseCommonContent(el);
    const { backgroundVocal: _backgroundVocal, ...bgVocal } = parsed;

    bgVocal.text = bgVocal.text.replace(/^[(（]+/, "").replace(/[)）]+$/, "");

    if (bgVocal.words && bgVocal.words.length > 0) {
      bgVocal.words[0].text = bgVocal.words[0].text.replace(/^[(（]+/, "").trimStart();

      const lastIdx = bgVocal.words.length - 1;
      bgVocal.words[lastIdx].text = bgVocal.words[lastIdx].text.replace(/[)）]+$/, "").trimEnd();
    }

    return bgVocal;
  }

  /**
   * 解析内联翻译/音译
   */
  private parseInlineSubContent(
    el: MinimalElement,
  ): { main?: SubLyricContent; bg?: SubLyricContent } | null {
    const lang = this.getAttr(el, NS.XML, Attributes.Lang, QualifiedAttributes.XmlLang);
    const parsed = this.parseCommonContent(el);
    const content = this.extractSubContent(parsed, lang, true);

    if (content.main || content.bg) {
      return content;
    }
    return null;
  }

  /**
   * 规范化修剪行内首尾单词空白
   */
  private finalizeWords(words: Syllable[]): Syllable[] {
    if (words.length === 0) return [];

    words[0].text = words[0].text.trimStart();

    const lastIdx = words.length - 1;
    words[lastIdx].text = words[lastIdx].text.trimEnd();
    words[lastIdx].endsWithSpace = false;

    return words;
  }
}
