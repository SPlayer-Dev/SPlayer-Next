/**
 * TTML 歌词生成器核心实现
 * 将统一歌词数据结构序列化为规范的 TTML XML 字符串
 */

import type { LyricResult } from "@shared/types/lyrics";
import { NS, Values } from "./constants";
import type { GeneratorOptions, TTMLResult } from "./types";

/**
 * 格式化毫秒数值为 TTML 标准时间戳字符串（如 00:01.234 或 01:05:00.000）
 * @param ms - 毫秒数值
 * @returns 格式化后的时间字符串
 */
export function formatTime(ms: number): string {
  const validMs = Math.max(0, Math.round(ms || 0));
  const totalSeconds = Math.floor(validMs / 1000);
  const milliseconds = validMs % 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = minutes.toString().padStart(2, "0");
  const ss = seconds.toString().padStart(2, "0");
  const fff = milliseconds.toString().padStart(3, "0");

  if (hours > 0) {
    const hh = hours.toString().padStart(2, "0");
    return `${hh}:${mm}:${ss}.${fff}`;
  }
  return `${mm}:${ss}.${fff}`;
}

/**
 * XML 特殊字符转义
 * @param str - 原始文本字符串
 * @returns 转义后的 XML 安全文本
 */
function escapeXml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface NormalizedWord {
  text: string;
  startTime: number;
  endTime: number;
  endsWithSpace?: boolean;
  obscene?: boolean;
  emptyBeat?: number;
  ruby?: Array<{ text: string; startTime: number; endTime: number }>;
}

interface NormalizedLine {
  id: string;
  startTime: number;
  endTime: number;
  words: NormalizedWord[];
  text: string;
  translatedLyric?: string;
  romanLyric?: string;
  isBG?: boolean;
  agentId: string;
  songPart?: string;
  blockIndex?: number;
  backgroundVocal?: {
    text: string;
    startTime: number;
    endTime: number;
    words?: NormalizedWord[];
  };
}

/**
 * 安全提取音节中的字词文本
 * @param item - 音节或单词对象
 * @returns 提取的文本
 */
function extractWordText(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  if ("text" in item && typeof item.text === "string") return item.text;
  if ("word" in item && typeof item.word === "string") return item.word;
  return "";
}

export class TTMLGenerator {
  /**
   * 将歌词数据生成为标准 TTML XML 字符串
   * @param input - SPlayer 统一歌词结果或 AST TTMLResult
   * @param options - 生成器配置选项
   * @returns 格式化后的 XML 文本
   */
  public static generate(input: LyricResult | TTMLResult, options?: GeneratorOptions): string {
    const metadata = input.metadata || {};
    const lines = input.lines || [];

    const timingMode = metadata.timingMode || "Word";
    const language =
      options?.language ||
      ("language" in metadata && typeof metadata.language === "string" && metadata.language) ||
      "und";
    const translationLang = options?.translationLanguage || "zh-Hans";
    const romanizationLang = options?.romanizationLanguage || "und-Latn";
    const useSidecar = options?.useSidecar ?? true;

    // 归一化歌词行数据
    const normalizedLines: NormalizedLine[] = lines.map((line, idx) => {
      const id = line.id || `L${idx + 1}`;
      const agentId = ("agentId" in line && line.agentId) || Values.AgentDefault;

      const rawWords: unknown[] = Array.isArray(line.words) ? line.words : [];
      const words: NormalizedWord[] = rawWords.map((raw) => {
        const w = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        const rawRuby: unknown[] = Array.isArray(w.ruby) ? w.ruby : [];

        const ruby = rawRuby.map((rawR) => {
          const r = (rawR && typeof rawR === "object" ? rawR : {}) as Record<string, unknown>;
          return {
            text: extractWordText(r),
            startTime: typeof r.startTime === "number" ? r.startTime : 0,
            endTime: typeof r.endTime === "number" ? r.endTime : 0,
          };
        });

        return {
          text: extractWordText(w),
          startTime: typeof w.startTime === "number" ? w.startTime : 0,
          endTime: typeof w.endTime === "number" ? w.endTime : 0,
          endsWithSpace: Boolean(w.endsWithSpace),
          obscene: Boolean(w.obscene),
          emptyBeat: typeof w.emptyBeat === "number" ? w.emptyBeat : undefined,
          ruby: ruby.length > 0 ? ruby : undefined,
        };
      });

      const fullText =
        ("text" in line && typeof line.text === "string" && line.text) ||
        words.map((w) => w.text + (w.endsWithSpace ? " " : "")).join("") ||
        "";

      let bgVocal: NormalizedLine["backgroundVocal"];
      if ("backgroundVocal" in line && line.backgroundVocal) {
        const bg = line.backgroundVocal;
        const bgRawWords: unknown[] = Array.isArray(bg.words) ? bg.words : [];
        bgVocal = {
          text: bg.text,
          startTime: bg.startTime,
          endTime: bg.endTime,
          words: bgRawWords.map((raw) => {
            const w = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
            return {
              text: extractWordText(w),
              startTime: typeof w.startTime === "number" ? w.startTime : 0,
              endTime: typeof w.endTime === "number" ? w.endTime : 0,
              endsWithSpace: Boolean(w.endsWithSpace),
              obscene: Boolean(w.obscene),
              emptyBeat: typeof w.emptyBeat === "number" ? w.emptyBeat : undefined,
            };
          }),
        };
      }

      let transText = "translatedLyric" in line ? line.translatedLyric : undefined;
      if (!transText && "translations" in line && Array.isArray(line.translations)) {
        transText = line.translations[0]?.text;
      }

      let romanText = "romanLyric" in line ? line.romanLyric : undefined;
      if (!romanText && "romanizations" in line && Array.isArray(line.romanizations)) {
        romanText = line.romanizations[0]?.text;
      }

      return {
        id,
        startTime: line.startTime || 0,
        endTime: line.endTime || 0,
        words,
        text: fullText,
        translatedLyric: transText,
        romanLyric: romanText,
        isBG: Boolean("isBG" in line && line.isBG),
        agentId,
        songPart:
          "songPart" in line && typeof line.songPart === "string" ? line.songPart : undefined,
        blockIndex:
          "blockIndex" in line && typeof line.blockIndex === "number" ? line.blockIndex : undefined,
        backgroundVocal: bgVocal,
      };
    });

    const linesMaxEnd =
      normalizedLines.length > 0 ? Math.max(...normalizedLines.map((l) => l.endTime)) : 0;
    const bodyDur = formatTime(linesMaxEnd);

    // 收集声部 Agent 列表
    const agentsMap = new Map<string, { id: string; name?: string; type?: string }>();
    if ("agents" in metadata && metadata.agents) {
      Object.values(metadata.agents).forEach((a) => {
        if (a?.id) agentsMap.set(a.id, a);
      });
    }
    normalizedLines.forEach((l) => {
      if (l.agentId && !agentsMap.has(l.agentId)) {
        agentsMap.set(l.agentId, { id: l.agentId, type: Values.Person });
      }
    });

    const xmlLines: string[] = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<tt xmlns="${NS.TT}"`,
      `    xmlns:ttm="${NS.TTM}"`,
      `    xmlns:itunes="${NS.ITUNES}"`,
      `    xmlns:amll="${NS.AMLL}"`,
      `    xmlns:tts="${NS.TTS}"`,
      `    xml:lang="${escapeXml(language)}"`,
      `    itunes:timing="${escapeXml(timingMode)}">`,
      "  <head>",
      "    <metadata>",
    ];

    // 声部 Agent 节点
    agentsMap.forEach((agent) => {
      const typeAttr = agent.type ? ` type="${escapeXml(agent.type)}"` : "";
      if (agent.name) {
        xmlLines.push(
          `      <ttm:agent${typeAttr} xml:id="${escapeXml(agent.id)}">`,
          `        <ttm:name type="full">${escapeXml(agent.name)}</ttm:name>`,
          "      </ttm:agent>",
        );
      } else {
        xmlLines.push(`      <ttm:agent${typeAttr} xml:id="${escapeXml(agent.id)}" />`);
      }
    });

    // 歌曲标题
    metadata.title?.forEach((t) => {
      xmlLines.push(`      <ttm:title>${escapeXml(t)}</ttm:title>`);
    });

    // AMLL 规范元数据
    metadata.artist?.forEach((a) => {
      xmlLines.push(`      <amll:meta key="${Values.Artists}" value="${escapeXml(a)}" />`);
    });
    metadata.album?.forEach((al) => {
      xmlLines.push(`      <amll:meta key="${Values.Album}" value="${escapeXml(al)}" />`);
    });
    metadata.isrc?.forEach((isrc) => {
      xmlLines.push(`      <amll:meta key="${Values.ISRC}" value="${escapeXml(isrc)}" />`);
    });

    if (metadata.platformIds) {
      Object.entries(metadata.platformIds).forEach(([key, list]) => {
        list?.forEach((idVal) => {
          xmlLines.push(`      <amll:meta key="${escapeXml(key)}" value="${escapeXml(idVal)}" />`);
        });
      });
    }

    if (metadata.rawProperties) {
      Object.entries(metadata.rawProperties).forEach(([key, list]) => {
        list?.forEach((val) => {
          xmlLines.push(`      <amll:meta key="${escapeXml(key)}" value="${escapeXml(val)}" />`);
        });
      });
    }

    // iTunesMetadata（词曲作者与 Sidecar 多语言）
    const hasSongwriters = Boolean(metadata.songwriters && metadata.songwriters.length > 0);
    const transLines = normalizedLines.filter((l) => Boolean(l.translatedLyric));
    const romanLines = normalizedLines.filter((l) => Boolean(l.romanLyric));
    const hasSidecar =
      useSidecar && (transLines.length > 0 || romanLines.length > 0 || hasSongwriters);

    if (hasSidecar) {
      xmlLines.push(`      <iTunesMetadata xmlns="${NS.ITUNES}">`);
      if (hasSongwriters) {
        xmlLines.push("        <songwriters>");
        metadata.songwriters?.forEach((sw) => {
          xmlLines.push(`          <songwriter>${escapeXml(sw)}</songwriter>`);
        });
        xmlLines.push("        </songwriters>");
      }

      if (transLines.length > 0) {
        xmlLines.push("        <translations>");
        xmlLines.push(`          <translation xml:lang="${escapeXml(translationLang)}">`);
        transLines.forEach((l) => {
          xmlLines.push(
            `            <text for="${escapeXml(l.id)}">${escapeXml(l.translatedLyric!)}</text>`,
          );
        });
        xmlLines.push("          </translation>");
        xmlLines.push("        </translations>");
      }

      if (romanLines.length > 0) {
        xmlLines.push("        <transliterations>");
        xmlLines.push(`          <transliteration xml:lang="${escapeXml(romanizationLang)}">`);
        romanLines.forEach((l) => {
          xmlLines.push(
            `            <text for="${escapeXml(l.id)}">${escapeXml(l.romanLyric!)}</text>`,
          );
        });
        xmlLines.push("          </transliteration>");
        xmlLines.push("        </transliterations>");
      }

      xmlLines.push("      </iTunesMetadata>");
    }

    xmlLines.push("    </metadata>", "  </head>", `  <body dur="${bodyDur}">`);

    // 分 Div 结构输出
    let currentDivLines: NormalizedLine[] = [];
    let currentSongPart: string | undefined;
    let currentBlockIndex: number | undefined;

    const flushDiv = () => {
      if (currentDivLines.length === 0) return;
      const divStart = formatTime(Math.min(...currentDivLines.map((l) => l.startTime)));
      const divEnd = formatTime(Math.max(...currentDivLines.map((l) => l.endTime)));
      const songPartAttr = currentSongPart
        ? ` itunes:songPart="${escapeXml(currentSongPart)}"`
        : "";

      xmlLines.push(`    <div begin="${divStart}" end="${divEnd}"${songPartAttr}>`);

      for (const line of currentDivLines) {
        const pStart = formatTime(line.startTime);
        const pEnd = formatTime(line.endTime);
        const agentAttr = line.agentId ? ` ttm:agent="${escapeXml(line.agentId)}"` : "";

        xmlLines.push(
          `      <p begin="${pStart}" end="${pEnd}" itunes:key="${escapeXml(line.id)}"${agentAttr}>`,
        );

        if (line.words.length > 0) {
          const spansHtml = line.words
            .map((w) => {
              const spaceSuffix = w.endsWithSpace ? " " : "";
              const obsceneAttr = w.obscene ? ' amll:obscene="true"' : "";
              const emptyBeatAttr =
                w.emptyBeat !== undefined ? ` amll:empty-beat="${w.emptyBeat}"` : "";

              if (w.ruby && w.ruby.length > 0) {
                const rtSpans = w.ruby
                  .map(
                    (r) =>
                      `<span tts:ruby="text" begin="${formatTime(r.startTime)}" end="${formatTime(r.endTime)}">${escapeXml(r.text)}</span>`,
                  )
                  .join("");
                return `<span tts:ruby="container"${obsceneAttr}${emptyBeatAttr}><span tts:ruby="base">${escapeXml(w.text)}</span><span tts:ruby="textContainer">${rtSpans}</span></span>${spaceSuffix}`;
              }

              return `<span begin="${formatTime(w.startTime)}" end="${formatTime(w.endTime)}"${obsceneAttr}${emptyBeatAttr}>${escapeXml(w.text)}</span>${spaceSuffix}`;
            })
            .join("");

          xmlLines.push(`        ${spansHtml}`);
        } else if (line.text) {
          xmlLines.push(`        ${escapeXml(line.text)}`);
        }

        // 背景伴唱
        if (line.backgroundVocal) {
          const bg = line.backgroundVocal;
          const bgStart = formatTime(bg.startTime);
          const bgEnd = formatTime(bg.endTime);
          const bgWordsHtml = bg.words?.length
            ? bg.words
                .map((w) => {
                  const s = w.endsWithSpace ? " " : "";
                  return `<span begin="${formatTime(w.startTime)}" end="${formatTime(w.endTime)}">${escapeXml(w.text)}</span>${s}`;
                })
                .join("")
            : escapeXml(bg.text);

          xmlLines.push(
            `        <span ttm:role="x-bg" begin="${bgStart}" end="${bgEnd}">(${bgWordsHtml})</span>`,
          );
        }

        // 行内翻译与音译（当 useSidecar === false 时输出到正文 p 内）
        if (!useSidecar) {
          if (line.translatedLyric) {
            xmlLines.push(
              `        <span ttm:role="x-translation" xml:lang="${escapeXml(translationLang)}">${escapeXml(line.translatedLyric)}</span>`,
            );
          }
          if (line.romanLyric) {
            xmlLines.push(
              `        <span ttm:role="x-roman" xml:lang="${escapeXml(romanizationLang)}">${escapeXml(line.romanLyric)}</span>`,
            );
          }
        }

        xmlLines.push("      </p>");
      }

      xmlLines.push("    </div>");
      currentDivLines = [];
    };

    for (const line of normalizedLines) {
      if (
        currentDivLines.length > 0 &&
        (line.songPart !== currentSongPart || line.blockIndex !== currentBlockIndex)
      ) {
        flushDiv();
      }
      currentSongPart = line.songPart;
      currentBlockIndex = line.blockIndex;
      currentDivLines.push(line);
    }
    flushDiv();

    xmlLines.push("  </body>", "</tt>");
    return xmlLines.join("\n");
  }
}
