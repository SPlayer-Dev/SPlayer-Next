/**
 * 歌词序列化
 *
 * 把解析后的 LyricLine[] 重新序列化为标准歌词文本，用于下载保存 / 内嵌
 * 走 parse → 重序列化，[ti:]/[ar:] 等信息头天然被丢弃，内容只剩歌词
 */

import type { LyricFormat, LyricInput } from "@shared/types/lyrics";
import type { DownloadLyricFormat } from "@shared/types/download";
import { parseLyric, toEnhancedLRC, toLRC, toTTML } from "lyric-kit";

/**
 * 把下载到的歌词序列化为指定格式
 * - lrc / enhanced-lrc：丢弃信息头，双语写主 + 翻译
 * - ttml：源格式已是 ttml 则直接保留原文本（避免格式化丢失元数据与样式）；其它格式转换为标准 ttml
 * @param input - 主歌词 + 可选翻译 / 音译
 * @param mainFormat - 主歌词源格式
 * @param target - 目标格式
 * @returns 歌词文本；无有效内容返回 null
 */
export const buildDownloadLyric = (
  input: LyricInput,
  mainFormat: LyricFormat,
  target: DownloadLyricFormat | "ttml",
): string | null => {
  if (!input.content?.trim()) return null;
  let result;
  try {
    result = parseLyric({
      content: input.content,
      format: mainFormat,
      translation: input.translation,
      translationFormat: input.translationFormat,
      romaji: input.romaji,
      romajiFormat: input.romajiFormat,
    });
  } catch {
    return null;
  }
  if (result.lines.length === 0) return null;
  if (target === "ttml") {
    return mainFormat === "ttml" ? input.content.trim() : toTTML(result);
  }
  const content = target === "enhanced-lrc" ? toEnhancedLRC(result.lines) : toLRC(result.lines);
  return content.trim() ? content : null;
};
