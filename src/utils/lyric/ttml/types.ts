/**
 * TTML 解析与生成模块类型定义
 */

export interface MinimalNode {
  readonly nodeType: number;
  textContent: string | null;
  readonly childNodes: ArrayLike<MinimalNode> | Iterable<MinimalNode>;
  readonly localName?: string | null;
  readonly tagName?: string;
  readonly nodeName?: string;
  readonly firstChild?: MinimalNode | null;
}

export interface MinimalAttribute {
  localName?: string | null;
  nodeName: string;
  value: string;
}

export interface MinimalElement extends MinimalNode {
  readonly localName: string | null;
  readonly tagName: string;
  readonly attributes: ArrayLike<MinimalAttribute> | Iterable<MinimalAttribute>;

  getAttribute(name: string): string | null;
  getAttributeNS(namespace: string | null, localName: string): string | null;
  hasAttributes(): boolean;

  setAttribute(name: string, value: string): void;
  setAttributeNS(namespace: string | null, qualifiedName: string, value: string): void;

  getElementsByTagName(name: string): ArrayLike<MinimalElement> | Iterable<MinimalElement>;
  getElementsByTagNameNS(
    namespaceURI: string,
    localName: string,
  ): ArrayLike<MinimalElement> | Iterable<MinimalElement>;

  appendChild(node: MinimalNode): MinimalNode;
  removeChild(child: MinimalNode): MinimalNode;
}

export interface MinimalDocument extends MinimalNode {
  readonly documentElement: MinimalElement | null;
  getElementsByTagName(name: string): ArrayLike<MinimalElement> | Iterable<MinimalElement>;
  createElement(tagName: string): MinimalElement;
  createElementNS(namespaceURI: string | null, qualifiedName: string): MinimalElement;
  createTextNode(data: string): MinimalNode;
  appendChild(node: MinimalNode): MinimalNode;
}

export interface MinimalDOMParser {
  parseFromString(string: string, type: DOMParserSupportedType | string): MinimalDocument;
}

export interface MinimalDOMImplementation {
  createDocument(
    namespaceURI: string | null,
    qualifiedName: string | null,
    doctype?: MinimalNode | null,
  ): MinimalDocument;
}

export interface MinimalXMLSerializer {
  serializeToString(root: MinimalNode): string;
}

/** 解析器配置选项 */
export interface TTMLParserOptions {
  /** 注入的 DOMParser 实例 */
  domParser?: MinimalDOMParser;
  /** 是否清洗康熙部首及兼容表意汉字 */
  cleanKangxi?: boolean;
}

/** 生成器配置选项 */
export interface GeneratorOptions {
  /** 注入的 DOMImplementation 实例 */
  domImplementation?: MinimalDOMImplementation;
  /** 注入的 XMLSerializer 实例 */
  xmlSerializer?: MinimalXMLSerializer;
  /** 对于逐行翻译/音译，是否放入 Head (Apple Music 风格) */
  useSidecar?: boolean;
}

/** 翻译/音译内容 */
export interface SubLyricContent {
  language?: string;
  text: string;
  words?: Syllable[];
}

/** 注音单元 */
export interface Ruby {
  text: string;
  startTime: number;
  endTime: number;
}

/** 逐字音节信息 */
export interface Syllable {
  text: string;
  startTime: number;
  endTime: number;
  endsWithSpace?: boolean;
  obscene?: boolean;
  emptyBeat?: number;
  ruby?: Ruby[];
}

/** 基础歌词内容 */
export interface LyricBase {
  text: string;
  startTime: number;
  endTime: number;
  words?: Syllable[];
  translations?: SubLyricContent[];
  romanizations?: SubLyricContent[];
  backgroundVocal?: BackgroundVocal;
}

/** 背景人声内容 */
export type BackgroundVocal = Omit<LyricBase, "backgroundVocal">;

/** 完整歌词行 AST 节点 */
export interface LyricLine extends LyricBase {
  id?: string;
  agentId?: string;
  songPart?: string;
  blockIndex?: number;
}

/** 演唱者/声部信息 */
export interface Agent {
  id: string;
  name?: string;
  type?: string;
}

export type PlatformId = "ncmMusicId" | "qqMusicId" | "spotifyId" | "appleMusicId" | string;

/** TTML 元数据 AST */
export interface TTMLMetadata {
  title?: string[];
  artist?: string[];
  album?: string[];
  isrc?: string[];
  authorIds?: string[];
  authorNames?: string[];
  songwriters?: string[];
  agents?: Record<string, Agent>;
  platformIds?: Record<string, string[]>;
  rawProperties?: Record<string, string[]>;
  language?: string;
  timingMode?: "Word" | "Line";
  offset?: number;
}

/** TTML 完整 AST 解析结果 */
export interface TTMLResult {
  metadata: TTMLMetadata;
  lines: LyricLine[];
}

/** 歌词单词基础结构 */
export interface LyricWordBase {
  startTime: number;
  endTime: number;
  word: string;
}

/** AMLL 单个单词结构 */
export interface AmllLyricWord extends LyricWordBase {
  romanWord?: string;
  obscene?: boolean;
  emptyBeat?: number;
  ruby?: LyricWordBase[];
}

/** AMLL 单行歌词结构 */
export interface AmllLyricLine {
  words: AmllLyricWord[];
  translatedLyric: string;
  romanLyric: string;
  isBG: boolean;
  isDuet: boolean;
  startTime: number;
  endTime: number;
}

/** AMLL 元数据键值对 */
export type AmllMetadata = [string, string[]];

/** AMLL 扁平化歌词结果 */
export interface AmllLyricResult {
  lines: AmllLyricLine[];
  metadata: AmllMetadata[];
}

/** TTML 转 AMLL 配置选项 */
export interface TTMLToAmllOptions {
  /** 翻译的首选目标语言代码 */
  translationLanguage?: string;
  /** 音译的首选目标语言代码 */
  romanizationLanguage?: string;
  /** 是否自动剥离背景歌词首尾的中英文圆括号 */
  stripBackgroundParens?: boolean;
}

/** AMLL 转 TTML 配置选项 */
export interface AmllToTTMLOptions {
  translationLanguage?: string;
  romanizationLanguage?: string;
}

/** TTML 解析器对外统一配置选项 */
export interface ParseTTMLOptions extends TTMLParserOptions, TTMLToAmllOptions {
  preferredLang?: string;
  extractMetadata?: boolean;
}
