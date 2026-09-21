/**
 * TTML 歌词生成器核心实现
 * 将内部结构化 AST 序列化为规范的 TTML XML 字符串
 */

import { Attributes, Elements, NS, QualifiedAttributes, Values } from "./constants";
import type {
  Agent,
  GeneratorOptions,
  LyricBase,
  MinimalDocument,
  MinimalDOMImplementation,
  MinimalElement,
  MinimalXMLSerializer,
  SubLyricContent,
  Syllable,
  TTMLResult,
} from "./types";

export class TTMLGenerator {
  private domImpl: MinimalDOMImplementation;
  private options: GeneratorOptions;
  private xmlSerializer: MinimalXMLSerializer;
  private doc!: MinimalDocument;
  private timingMode: "Word" | "Line" = "Line";

  /**
   * 构造 TTML 生成器实例
   * @param options - 生成器配置选项，支持注入 domImplementation 与 xmlSerializer
   */
  constructor(options: GeneratorOptions = {}) {
    this.options = options;

    if (this.options.domImplementation) {
      this.domImpl = this.options.domImplementation;
    } else if (typeof document !== "undefined" && document.implementation) {
      this.domImpl = document.implementation as unknown as MinimalDOMImplementation;
    } else {
      throw new Error(
        "No DOMImplementation found. If you are running in Node.js, please inject via options.",
      );
    }

    if (this.options.xmlSerializer) {
      this.xmlSerializer = this.options.xmlSerializer;
    } else if (typeof XMLSerializer !== "undefined") {
      this.xmlSerializer = new XMLSerializer() as unknown as MinimalXMLSerializer;
    } else {
      throw new Error(
        "No XMLSerializer found. If you are running in Node.js, please inject via options.",
      );
    }
  }

  /**
   * 生成 TTML 字符串的静态便捷方法
   * @param result - TTML AST 数据结构
   * @param options - 生成器配置选项
   * @returns 序列化后的 TTML XML 字符串
   */
  public static generate(result: TTMLResult, options?: GeneratorOptions): string {
    const instance = new TTMLGenerator(options);
    return instance.generate(result);
  }

  /**
   * 生成 TTML XML 字符串
   * @param result - TTML AST 数据结构
   * @returns 序列化后的 TTML XML 字符串
   */
  public generate(result: TTMLResult): string {
    this.doc = this.domImpl.createDocument(NS.TT, Elements.TT, null);
    this.timingMode = result.metadata.timingMode || "Line";

    const allLinesHaveId = result.lines.every(
      (line) => typeof line.id === "string" && line.id.trim() !== "",
    );

    result.lines.forEach((line, index) => {
      if (!allLinesHaveId) {
        line.id = `L${index + 1}`;
      }
      if (!line.agentId) {
        line.agentId = Values.AgentDefault;
      }
    });

    let root = this.doc.documentElement;
    if (!root) {
      root = this.doc.createElementNS(NS.TT, Elements.TT);
      this.doc.appendChild(root);
    } else {
      while (root.firstChild) {
        root.removeChild(root.firstChild);
      }
    }

    this.setupRootAttributes(root, result);

    const head = this.buildHead(result);
    root.appendChild(head);

    const body = this.buildBody(result);
    root.appendChild(body);

    return this.xmlSerializer.serializeToString(this.doc);
  }

  /**
   * 设置根节点命名空间与属性
   */
  private setupRootAttributes(root: MinimalElement, result: TTMLResult): void {
    root.setAttribute(Attributes.Xmlns, NS.TT);
    root.setAttributeNS(NS.XMLNS, QualifiedAttributes.XmlnsAmll, NS.AMLL);
    root.setAttributeNS(NS.XMLNS, QualifiedAttributes.XmlnsItunes, NS.ITUNES);
    root.setAttributeNS(NS.XMLNS, QualifiedAttributes.XmlnsTtm, NS.TTM);
    root.setAttributeNS(NS.XMLNS, QualifiedAttributes.XmlnsTts, NS.TTS);
    root.setAttribute("xmlns:amll", NS.AMLL);
    root.setAttribute("xmlns:itunes", NS.ITUNES);
    root.setAttribute("xmlns:ttm", NS.TTM);
    root.setAttribute("xmlns:tts", NS.TTS);

    if (result.metadata.language) {
      root.setAttributeNS(NS.XML, QualifiedAttributes.XmlLang, result.metadata.language);
      root.setAttribute("xml:lang", result.metadata.language);
    }

    const effectiveTiming = this.timingMode || result.metadata.timingMode || "Word";
    root.setAttributeNS(NS.ITUNES, QualifiedAttributes.ITunesTiming, effectiveTiming);
    root.setAttribute("itunes:timing", effectiveTiming);
  }

  private isLyricBase(content: LyricBase | SubLyricContent): content is LyricBase {
    return "startTime" in content;
  }

  private isWordByWord(words?: Syllable[]): boolean {
    if (!words || words.length === 0) return false;
    return true;
  }

  private shouldMoveToSidecar(content: SubLyricContent): boolean {
    if (content.words && content.words.length > 0) return true;
    return Boolean(this.options.useSidecar);
  }

  /**
   * 构建 Head 元素与其下元数据标签
   */
  private buildHead(result: TTMLResult): MinimalElement {
    const head = this.doc.createElement(Elements.Head);
    const metadata = this.doc.createElement(Elements.TTMLMetadata);
    const meta = result.metadata;

    let agentsToGenerate: Agent[] = [];

    if (meta.agents && Object.keys(meta.agents).length > 0) {
      agentsToGenerate = Object.values(meta.agents);
    } else {
      const uniqueAgentIds = new Set<string>();
      result.lines.forEach((line) => {
        if (line.agentId) uniqueAgentIds.add(line.agentId);
      });

      uniqueAgentIds.forEach((id) => {
        agentsToGenerate.push({
          id,
          type: id === Values.AgentGroup ? Values.Group : Values.Person,
        });
      });
    }

    agentsToGenerate.forEach((agent) => {
      const { id, name, type: agentType } = agent;
      const agentEl = this.doc.createElementNS(NS.TTM, QualifiedAttributes.TTMAgent);
      const type = agentType || (id === Values.AgentGroup ? Values.Group : Values.Person);

      agentEl.setAttribute(Attributes.Type, type);
      agentEl.setAttribute(QualifiedAttributes.XmlId, id);

      if (name) {
        const nameEl = this.doc.createElementNS(NS.TTM, QualifiedAttributes.TTMName);
        nameEl.setAttribute(Attributes.Type, Values.Full);
        nameEl.textContent = name;
        agentEl.appendChild(nameEl);
      }

      metadata.appendChild(agentEl);
    });

    this.buildITunesMetadata(metadata, result);

    const addAmllMeta = (key: string, value: string): void => {
      const el = this.doc.createElementNS(NS.AMLL, QualifiedAttributes.AmllMeta);
      el.setAttribute(Attributes.Key, key);
      el.setAttribute(Attributes.Value, value);
      metadata.appendChild(el);
    };

    meta.title?.forEach((v) => addAmllMeta(Values.MusicName, v));
    meta.artist?.forEach((v) => addAmllMeta(Values.Artists, v));
    meta.album?.forEach((v) => addAmllMeta(Values.Album, v));

    if (result.metadata.platformIds) {
      Object.entries(result.metadata.platformIds).forEach(([key, values]) => {
        values?.forEach((v) => addAmllMeta(key, v));
      });
    }

    meta.isrc?.forEach((v) => addAmllMeta(Values.ISRC, v));
    meta.authorIds?.forEach((v) => addAmllMeta(Values.TTMLAuthorGithub, v));
    meta.authorNames?.forEach((v) => addAmllMeta(Values.TTMLAuthorGithubLogin, v));

    if (meta.rawProperties) {
      Object.entries(meta.rawProperties).forEach(([key, values]) => {
        values?.forEach((v) => addAmllMeta(key, v));
      });
    }

    head.appendChild(metadata);
    return head;
  }

  /**
   * 构建 iTunesMetadata（Sidecar 翻译/音译与词曲作者）
   */
  private buildITunesMetadata(metadataEl: MinimalElement, result: TTMLResult): void {
    const iTunesMeta = this.doc.createElement(Elements.ITunesMetadata);
    iTunesMeta.setAttribute(Attributes.Xmlns, NS.ITUNES_INTERNAL);

    let hasContent = false;

    const translationsMap = new Map<
      string | undefined,
      Array<{ id: string; main?: SubLyricContent; bg?: SubLyricContent }>
    >();
    const romansMap = new Map<
      string | undefined,
      Array<{ id: string; main?: SubLyricContent; bg?: SubLyricContent }>
    >();

    for (const line of result.lines) {
      const pairedTrans = this.pairSubContents(
        line.translations,
        line.backgroundVocal?.translations,
      );
      for (const pair of pairedTrans) {
        if (
          (pair.main && this.shouldMoveToSidecar(pair.main)) ||
          (pair.bg && this.shouldMoveToSidecar(pair.bg))
        ) {
          if (!translationsMap.has(pair.lang)) translationsMap.set(pair.lang, []);
          translationsMap.get(pair.lang)?.push({
            id: line.id!,
            main: pair.main,
            bg: pair.bg,
          });
        }
      }

      const pairedRomans = this.pairSubContents(
        line.romanizations,
        line.backgroundVocal?.romanizations,
      );
      for (const pair of pairedRomans) {
        if (
          (pair.main && this.shouldMoveToSidecar(pair.main)) ||
          (pair.bg && this.shouldMoveToSidecar(pair.bg))
        ) {
          if (!romansMap.has(pair.lang)) romansMap.set(pair.lang, []);
          romansMap.get(pair.lang)?.push({
            id: line.id!,
            main: pair.main,
            bg: pair.bg,
          });
        }
      }
    }

    if (translationsMap.size > 0) {
      const container = this.doc.createElement(Elements.Translations);
      for (const [lang, items] of translationsMap) {
        const transEl = this.doc.createElement(Elements.Translation);
        if (lang) transEl.setAttribute(QualifiedAttributes.XmlLang, lang);

        items.forEach((item) => {
          const textEl = this.doc.createElement(Elements.Text);
          textEl.setAttribute(Attributes.For, item.id);

          if (item.main) this.appendContentToElement(textEl, item.main);
          if (item.bg) this.appendBackgroundVocal(textEl, item.bg);

          transEl.appendChild(textEl);
        });
        container.appendChild(transEl);
      }
      iTunesMeta.appendChild(container);
      hasContent = true;
    }

    if (romansMap.size > 0) {
      const container = this.doc.createElement(Elements.Transliterations);
      for (const [lang, items] of romansMap) {
        const transEl = this.doc.createElement(Elements.Transliteration);
        if (lang) transEl.setAttribute(QualifiedAttributes.XmlLang, lang);

        items.forEach((item) => {
          const textEl = this.doc.createElement(Elements.Text);
          textEl.setAttribute(Attributes.For, item.id);

          if (item.main) this.appendContentToElement(textEl, item.main);
          if (item.bg) this.appendBackgroundVocal(textEl, item.bg);

          transEl.appendChild(textEl);
        });
        container.appendChild(transEl);
      }
      iTunesMeta.appendChild(container);
      hasContent = true;
    }

    if (result.metadata.songwriters && result.metadata.songwriters.length > 0) {
      const container = this.doc.createElement(Elements.Songwriters);
      result.metadata.songwriters.forEach((name) => {
        const sw = this.doc.createElement(Elements.Songwriter);
        sw.textContent = name;
        container.appendChild(sw);
      });
      iTunesMeta.appendChild(container);
      hasContent = true;
    }

    if (hasContent) {
      metadataEl.appendChild(iTunesMeta);
    }
  }

  /**
   * 构建 Body 元素与段落结构
   */
  private buildBody(result: TTMLResult): MinimalElement {
    const body = this.doc.createElement(Elements.Body);
    const lines = result.lines;
    const lastTime = lines.length > 0 ? Math.max(...lines.map((l) => l.endTime)) : 0;
    body.setAttribute(Attributes.Dur, this.formatTime(lastTime));

    let currentDiv: MinimalElement | null = null;
    let currentSongPart: string | undefined;
    let currentBlockIndex: number | undefined;
    let currentSectionEndTime = 0;

    const finalizeCurrentDiv = (): void => {
      if (currentDiv && currentSectionEndTime > 0) {
        currentDiv.setAttribute(Attributes.End, this.formatTime(currentSectionEndTime));
        if (currentSongPart) {
          currentDiv.setAttributeNS(NS.ITUNES, QualifiedAttributes.ITunesPart, currentSongPart);
          currentDiv.setAttribute("itunes:songPart", currentSongPart);
        }
      }
    };

    for (const line of lines) {
      if (
        line.songPart !== currentSongPart ||
        line.blockIndex !== currentBlockIndex ||
        !currentDiv
      ) {
        finalizeCurrentDiv();

        currentSongPart = line.songPart;
        currentBlockIndex = line.blockIndex;
        currentSectionEndTime = 0;

        currentDiv = this.doc.createElement(Elements.Div);
        currentDiv.setAttribute(Attributes.Begin, this.formatTime(line.startTime));
        body.appendChild(currentDiv);
      }

      if (line.endTime > currentSectionEndTime) {
        currentSectionEndTime = line.endTime;
      }

      const p = this.doc.createElement(Elements.P);
      p.setAttribute(Attributes.Begin, this.formatTime(line.startTime));
      p.setAttribute(Attributes.End, this.formatTime(line.endTime));
      p.setAttributeNS(NS.ITUNES, QualifiedAttributes.ITunesKey, line.id!);
      p.setAttribute("itunes:key", line.id!);
      if (line.agentId) {
        p.setAttributeNS(NS.TTM, QualifiedAttributes.TTMAgent, line.agentId);
        p.setAttribute("ttm:agent", line.agentId);
      }

      this.appendContentToElement(p, line);
      currentDiv.appendChild(p);
    }

    finalizeCurrentDiv();
    return body;
  }

  /**
   * 按语言配对主内容与背景内容
   */
  private pairSubContents(
    mainList?: SubLyricContent[],
    bgList?: SubLyricContent[],
  ): Array<{ lang?: string; main?: SubLyricContent; bg?: SubLyricContent }> {
    const map = new Map<
      string | undefined,
      { lang?: string; main?: SubLyricContent; bg?: SubLyricContent }
    >();

    const getEntry = (lang?: string) => {
      let entry = map.get(lang);
      if (!entry) {
        entry = { lang };
        map.set(lang, entry);
      }
      return entry;
    };

    mainList?.forEach((item) => {
      getEntry(item.language).main = item;
    });

    bgList?.forEach((item) => {
      getEntry(item.language).bg = item;
    });

    return Array.from(map.values());
  }

  /**
   * 将歌词文本或逐字音节追加至 DOM 元素中
   */
  private appendContentToElement(
    element: MinimalElement,
    content: LyricBase | SubLyricContent,
    isBackground: boolean = false,
  ): void {
    if (this.isWordByWord(content.words) && content.words) {
      this.appendWords(element, content.words, isBackground);
    } else {
      let text = content.text || "";
      if (isBackground) {
        text = `(${text})`;
      }
      element.textContent = text;
    }

    if (this.isLyricBase(content)) {
      this.appendSubLyrics(element, content);
    }

    if ("backgroundVocal" in content && content.backgroundVocal) {
      this.appendBackgroundVocal(element, content.backgroundVocal);
    }
  }

  /**
   * 追加逐字音节节点序列
   */
  private appendWords(element: MinimalElement, words: Syllable[], isBackground: boolean): void {
    words.forEach((syllable, index) => {
      let text = syllable.text;

      if (isBackground) {
        if (index === 0) text = `(${text}`;
        if (index === words.length - 1) text = `${text})`;
      }

      if (syllable.ruby && syllable.ruby.length > 0) {
        this.appendRubySyllable(element, syllable, text);
      } else {
        this.appendNormalSyllable(element, syllable, text);
      }

      if (syllable.endsWithSpace) {
        const spaceNode = this.doc.createTextNode(" ");
        element.appendChild(spaceNode);
      }
    });
  }

  /**
   * 追加 Ruby 注音结构节点
   */
  private appendRubySyllable(element: MinimalElement, syllable: Syllable, text: string): void {
    const containerSpan = this.doc.createElement(Elements.Span);
    containerSpan.setAttributeNS(NS.TTS, QualifiedAttributes.TtsRuby, Values.RubyContainer);

    if (syllable.obscene) {
      containerSpan.setAttributeNS(NS.AMLL, QualifiedAttributes.AmllObscene, Values.True);
    }

    if (syllable.emptyBeat !== undefined) {
      containerSpan.setAttributeNS(
        NS.AMLL,
        QualifiedAttributes.AmllEmptyBeat,
        syllable.emptyBeat.toString(),
      );
    }

    const baseSpan = this.doc.createElement(Elements.Span);
    baseSpan.setAttributeNS(NS.TTS, QualifiedAttributes.TtsRuby, Values.RubyBase);
    baseSpan.textContent = text;
    containerSpan.appendChild(baseSpan);

    const textContainerSpan = this.doc.createElement(Elements.Span);
    textContainerSpan.setAttributeNS(NS.TTS, QualifiedAttributes.TtsRuby, Values.RubyTextContainer);

    syllable.ruby?.forEach((rt) => {
      const rtSpan = this.doc.createElement(Elements.Span);
      rtSpan.setAttributeNS(NS.TTS, QualifiedAttributes.TtsRuby, Values.RubyText);
      rtSpan.setAttribute(Attributes.Begin, this.formatTime(rt.startTime));
      rtSpan.setAttribute(Attributes.End, this.formatTime(rt.endTime));
      rtSpan.textContent = rt.text;
      textContainerSpan.appendChild(rtSpan);
    });

    containerSpan.appendChild(textContainerSpan);
    element.appendChild(containerSpan);
  }

  /**
   * 追加普通逐字音节节点
   */
  private appendNormalSyllable(element: MinimalElement, syllable: Syllable, text: string): void {
    const span = this.doc.createElement(Elements.Span);
    span.setAttribute(Attributes.Begin, this.formatTime(syllable.startTime));
    span.setAttribute(Attributes.End, this.formatTime(syllable.endTime));

    if (syllable.obscene) {
      span.setAttributeNS(NS.AMLL, QualifiedAttributes.AmllObscene, Values.True);
    }

    if (syllable.emptyBeat !== undefined) {
      span.setAttributeNS(
        NS.AMLL,
        QualifiedAttributes.AmllEmptyBeat,
        syllable.emptyBeat.toString(),
      );
    }

    span.textContent = text;
    element.appendChild(span);
  }

  /**
   * 追加内联翻译与音译节点
   */
  private appendSubLyrics(element: MinimalElement, content: LyricBase): void {
    if (content.translations) {
      content.translations.forEach((trans) => {
        if (!this.shouldMoveToSidecar(trans)) {
          const span = this.doc.createElement(Elements.Span);
          span.setAttributeNS(NS.TTM, QualifiedAttributes.TTMRole, Values.RoleTranslation);
          if (trans.language) {
            span.setAttributeNS(NS.XML, QualifiedAttributes.XmlLang, trans.language);
          }
          this.appendContentToElement(span, trans);
          element.appendChild(span);
        }
      });
    }

    if (content.romanizations) {
      content.romanizations.forEach((roman) => {
        if (!this.shouldMoveToSidecar(roman)) {
          const span = this.doc.createElement(Elements.Span);
          span.setAttributeNS(NS.TTM, QualifiedAttributes.TTMRole, Values.RoleRoman);
          if (roman.language) {
            span.setAttributeNS(NS.XML, QualifiedAttributes.XmlLang, roman.language);
          }
          this.appendContentToElement(span, roman);
          element.appendChild(span);
        }
      });
    }
  }

  /**
   * 追加背景人声节点
   */
  private appendBackgroundVocal(element: MinimalElement, bg: LyricBase | SubLyricContent): void {
    const bgSpan = this.doc.createElement(Elements.Span);
    bgSpan.setAttributeNS(NS.TTM, QualifiedAttributes.TTMRole, Values.RoleBg);

    if (this.isLyricBase(bg)) {
      if (bg.startTime > 0 && bg.endTime > 0) {
        bgSpan.setAttribute(Attributes.Begin, this.formatTime(bg.startTime));
        bgSpan.setAttribute(Attributes.End, this.formatTime(bg.endTime));
      }
    }

    this.appendContentToElement(bgSpan, bg, true);
    element.appendChild(bgSpan);
  }

  /**
   * 格式化毫秒为 TTML 规范的时间格式字符串
   * @param ms - 毫秒时间
   * @returns 格式化时间字符串（如 01:23.456）
   */
  public formatTime(ms: number): string {
    let validMs = ms;
    if (validMs < 0) validMs = 0;

    const totalSeconds = Math.floor(validMs / 1000);
    const milliseconds = validMs % 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const fff = milliseconds.toString().padStart(3, "0");

    if (minutes > 0) {
      const ss = seconds.toString().padStart(2, "0");
      return `${minutes}:${ss}.${fff}`;
    }
    return `${seconds}.${fff}`;
  }
}
