/**
 * TTML 模块统一对外出口
 */

import type { LyricResult } from "@shared/types/lyrics";
import { toSPlayerLyricResult } from "./converter";
import { TTMLGenerator } from "./generator";
import { TTMLParser } from "./parser";
import type { GeneratorOptions, ParseTTMLOptions, TTMLResult } from "./types";

export * from "./constants";
export * from "./converter";
export * from "./generator";
export * from "./parser";
export * from "./pickLanguage";
export type * from "./types";

/**
 * 将 TTML 格式 XML 字符串解析为适配 SPlayer-Next 渲染体系的 LyricResult
 * @param ttmlText - TTML XML 字符串
 * @param options - 解析配置选项
 * @returns SPlayer-Next 歌词解析结果
 */
export function parseTTML(ttmlText: string, options?: ParseTTMLOptions): LyricResult {
  const result = TTMLParser.parse(ttmlText, options);
  return toSPlayerLyricResult(result, options);
}

/**
 * 将歌词数据结构序列化导出为 TTML XML 字符串
 * @param input - SPlayer 统一歌词结果或 AST TTMLResult
 * @param options - 生成选项
 * @returns 规范格式化后的 TTML XML 字符串
 */
export function exportTTML(input: LyricResult | TTMLResult, options?: GeneratorOptions): string {
  return TTMLGenerator.generate(input, options);
}
