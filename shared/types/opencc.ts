/**
 * OpenCC 中文简繁转换配置选项
 *
 * - none: 不转换
 * - s2t: 简体到繁体 (Simplified Chinese to Traditional Chinese)
 * - t2s: 繁体到简体 (Traditional Chinese to Simplified Chinese)
 * - s2tw: 简体到台湾正体 (Simplified Chinese to Traditional Chinese (Taiwan Standard))
 * - tw2s: 台湾正体到简体 (Traditional Chinese (Taiwan Standard) to Simplified Chinese)
 * - s2hk: 简体到香港繁体 (Simplified Chinese to Traditional Chinese (Hong Kong variant))
 * - hk2s: 香港繁体到简体 (Traditional Chinese (Hong Kong variant) to Simplified Chinese)
 * - s2twp: 简体到繁体（台湾正体标准，并转换常用词汇）
 * - tw2sp: 繁体（台湾正体标准）到简体（并转换常用词汇）
 * - t2tw: 繁体（OpenCC标准）到台湾正体
 * - tw2t: 台湾正体到繁体（OpenCC标准）
 * - t2hk: 繁体（OpenCC标准）到香港繁体
 * - hk2t: 香港繁体到繁体（OpenCC标准）
 * - jp2t: 日本新字体到繁体
 * - t2jp: 繁体到日本新字体
 */
export type CjkTransformMode =
  | "none"
  | "s2t"
  | "t2s"
  | "s2tw"
  | "tw2s"
  | "s2hk"
  | "hk2s"
  | "s2twp"
  | "tw2sp"
  | "t2tw"
  | "tw2t"
  | "t2hk"
  | "hk2t"
  | "jp2t"
  | "t2jp";

export interface OpenccApi {
  /** 转换单个文本 */
  convert: (text: string, config: CjkTransformMode) => Promise<string>;
  /** 批量转换文本列表 */
  convertBatch: (texts: string[], config: CjkTransformMode) => Promise<string[]>;
}
