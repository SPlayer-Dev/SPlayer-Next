import type { LyricLine } from "lyric-kit";
import type { K20GTLanguage } from "../types/k20gt";
import type { NowPlayingPositionSync } from "../types/nowPlaying";

export const K20GT_VENDOR_ID = 0x3837;
export const K20GT_PRODUCT_ID = 0x60c6;
export const K20GT_REPORT_ID = 0xbc;
const MAX_TEXT_BYTES = 52;
const encoder = new TextEncoder();

/** 仅保留当前曲目显示所需的时间与分页文字 */
export interface K20GTCaption {
  start: number;
  end: number;
  pages: string[];
}

/**
 * 按设备容量分页，避免截断 UTF-8 字符
 * @param text - 完整文字
 * @returns 每页不超过 52 字节的文字
 */
export function splitK20GTText(text: string): string[] {
  const pages: string[] = [];
  let page = "";
  let size = 0;
  for (const char of text) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > MAX_TEXT_BYTES) {
      pages.push(page);
      page = "";
      size = 0;
    }
    page += char;
    size += bytes;
  }
  if (page) pages.push(page);
  return pages;
}

/**
 * 编码普通歌词报文，空文字表示退出歌词显示
 * @param text - 不超过 52 个 UTF-8 字节的单页文字
 * @returns 不含 Report ID 的 63 字节报文
 */
export function encodeK20GTReport(text: string): Uint8Array<ArrayBuffer> {
  const bytes = encoder.encode(text);
  if (bytes.length > MAX_TEXT_BYTES) throw new Error("K20 GT 单页文字超过 52 字节");
  const report = new Uint8Array(63);
  report.set([0xaa, 1, 0, 4 + bytes.length, 0, 2, 0x0b, text ? 1 : 0, text ? 5 : 0, bytes.length]);
  report.set(bytes, 10);
  return report;
}

/**
 * 预先计算主歌词分页，只保留当前曲目的轻量显示数据
 * @param lyric - 已解析的歌词
 * @param language - 显示语言，缺失时回退原文
 * @param duration - 曲目时长，单位为毫秒
 * @returns 去除背景人声并限制结束时间的分页歌词
 */
export function prepareK20GTCaptions(
  lyric: LyricLine[],
  language: K20GTLanguage,
  duration: number,
): K20GTCaption[] {
  const lines = lyric.filter((line) => !line.isBG);
  return lines.map((line, index) => {
    const original = line.words.map((word) => word.word).join("");
    const text =
      language === "translation"
        ? line.translatedLyric || original
        : language === "romanization"
          ? line.romanLyric || original
          : original;
    return {
      start: line.startTime,
      end: Math.min(line.endTime, lines[index + 1]?.startTime ?? Infinity, duration || Infinity),
      pages: splitK20GTText(text.trim()),
    };
  });
}

/**
 * 根据播放锚点选择当前页，支持暂停、倍速、跳转和歌词偏移
 * @param captions - 当前曲目的预处理歌词
 * @param anchor - 最近播放锚点
 * @param offsetMs - 歌词偏移，正值为提前
 * @param now - 当前墙钟毫秒
 * @returns 当前应显示的单页文字，间奏或停止时为空
 */
export function selectK20GTCaption(
  captions: K20GTCaption[],
  anchor: NowPlayingPositionSync,
  offsetMs: number,
  now = Date.now(),
): string {
  if (["idle", "loading", "stopped"].includes(anchor.state)) return "";
  const elapsed = anchor.playing ? Math.max(0, now - anchor.sendTimestamp) * anchor.speed : 0;
  const position = anchor.position + elapsed + offsetMs;
  let low = 0;
  let high = captions.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (captions[mid].start <= position) low = mid + 1;
    else high = mid;
  }
  const line = captions[low - 1];
  if (!line || position >= line.end || !line.pages.length) return "";
  const index = Math.min(
    line.pages.length - 1,
    Math.floor(((position - line.start) / Math.max(1, line.end - line.start)) * line.pages.length),
  );
  return line.pages[index];
}
