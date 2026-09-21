/**
 * TTML 模块统一对外出口
 */

import type { LyricResult } from "@shared/types/lyrics";
import { toAmllLyrics, toSPlayerLyricResult, toTTMLResult } from "./converter";
import { TTMLGenerator } from "./generator";
import { TTMLParser } from "./parser";
import type { AmllLyricResult, GeneratorOptions, ParseTTMLOptions, TTMLResult } from "./types";

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
 * 将 TTML 格式 XML 字符串解析为原始 AMLL 规范的 AmllLyricResult
 * @param ttmlText - TTML XML 字符串
 * @param options - 解析与转换选项
 * @returns AMLL 规范歌词结果
 */
export function parseAmllTTML(ttmlText: string, options?: ParseTTMLOptions): AmllLyricResult {
  const result = TTMLParser.parse(ttmlText, options);
  return toAmllLyrics(result, options);
}

/**
 * 将歌词数据结构序列化导出为 TTML XML 字符串
 * @param input - AMLL 歌词结果或结构化 TTMLResult
 * @param options - 生成选项
 * @returns 规范格式化后的 TTML XML 字符串
 */
export function exportTTML(
  input: AmllLyricResult | TTMLResult,
  options?: GeneratorOptions,
): string {
  const result: TTMLResult =
    "lines" in input &&
    input.lines.length > 0 &&
    "words" in input.lines[0] &&
    Array.isArray((input.lines[0] as unknown as { words: unknown }).words)
      ? "metadata" in input && Array.isArray(input.metadata)
        ? toTTMLResult(
            input.lines as AmllLyricResult["lines"],
            input.metadata as AmllLyricResult["metadata"],
          )
        : (input as TTMLResult)
      : (input as TTMLResult);

  const generator = new TTMLGenerator(options);
  return generator.generate(result);
}
