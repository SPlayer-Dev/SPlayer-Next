/**
 * TTML 解析与生成模块精简类型定义
 */

/** 注音单元（如振假名、拼音标注） */
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

/** 翻译 / 音译片段内容 */
export interface SubLyricContent {
  language?: string;
  text: string;
  words?: Syllable[];
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

/** 演唱者 / 声部信息 */
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

/** 解析器配置选项 */
export interface TTMLParserOptions {
  /** 是否清洗康熙部首及兼容表意汉字 */
  cleanKangxi?: boolean;
}

/** 生成器配置选项 */
export interface GeneratorOptions {
  /** 对于逐行翻译/音译，是否放入 Head (Apple Music 风格) */
  useSidecar?: boolean;
}

/** TTML 解析器对外统一配置选项 */
export interface ParseTTMLOptions extends TTMLParserOptions {
  preferredLang?: string;
  translationLanguage?: string;
  romanizationLanguage?: string;
  extractMetadata?: boolean;
  stripBackgroundParens?: boolean;
}
