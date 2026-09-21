/**
 * TTML 歌词生成器核心实现
 * 将统一歌词数据结构序列化为规范的 TTML XML 字符串
 */

import type { LyricResult } from "@shared/types/lyrics";
import { NS, Values } from "./constants";
import type { GeneratorOptions, TTMLResult } from "./types";

/**
 * 格式化毫秒数值为 TTML 时间字符串（如 01:23.456）
 */
export function formatTime(ms: number): string {
  const validMs = Math.max(0, ms || 0);
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

export class TTMLGenerator {
  public static generate(input: LyricResult | TTMLResult, _options?: GeneratorOptions): string {
    const metadata = input.metadata || {};
    const lines = input.lines || [];

    const timingMode = metadata.timingMode || "Word";
    const language = (metadata as { language?: string }).language || "ja";

    // 归一化歌词行
    const normalizedLines: NormalizedLine[] = lines.map((line, idx) => {
      const id = line.id || `L${idx + 1}`;
      const agentId = (line as { agentId?: string }).agentId || Values.AgentDefault;

      const rawWords = (line as { words?: unknown[] }).words || [];
      const words: NormalizedWord[] = rawWords.map((w: any) => ({
        text: w.text || w.word || "",
        startTime: w.startTime || 0,
        endTime: w.endTime || 0,
        endsWithSpace: Boolean(w.endsWithSpace),
        obscene: Boolean(w.obscene),
        emptyBeat: w.emptyBeat,
        ruby: w.ruby?.map((r: any) => ({
          text: r.text || r.word || "",
          startTime: r.startTime || 0,
          endTime: r.endTime || 0,
        })),
      }));

      const fullText =
        (line as { text?: string }).text ||
        words.map((w) => w.text + (w.endsWithSpace ? " " : "")).join("") ||
        "";

      let bgVocal: NormalizedLine["backgroundVocal"];
      if ("backgroundVocal" in line && line.backgroundVocal) {
        const bg = line.backgroundVocal;
        bgVocal = {
          text: bg.text,
          startTime: bg.startTime,
          endTime: bg.endTime,
          words: bg.words?.map((w: any) => ({
            text: w.text || w.word || "",
            startTime: w.startTime || 0,
            endTime: w.endTime || 0,
            endsWithSpace: Boolean(w.endsWithSpace),
            obscene: Boolean(w.obscene),
            emptyBeat: w.emptyBeat,
          })),
        };
      }

      // 提取翻译与音译文本
      let transText = (line as { translatedLyric?: string }).translatedLyric;
      if (!transText && "translations" in line && Array.isArray(line.translations)) {
        transText = line.translations[0]?.text;
      }

      let romanText = (line as { romanLyric?: string }).romanLyric;
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
        isBG: Boolean((line as { isBG?: boolean }).isBG),
        agentId,
        songPart: (line as { songPart?: string }).songPart,
        blockIndex: (line as { blockIndex?: number }).blockIndex,
        backgroundVocal: bgVocal,
      };
    });

    const linesMaxEnd =
      normalizedLines.length > 0 ? Math.max(...normalizedLines.map((l) => l.endTime)) : 0;
    const bodyDur = formatTime(linesMaxEnd);

    // 收集 Agents
    const agentsMap = new Map<string, { id: string; name?: string; type?: string }>();
    if ("agents" in metadata && metadata.agents) {
      Object.values(metadata.agents).forEach((a) => agentsMap.set(a.id, a));
    }
    normalizedLines.forEach((l) => {
      if (l.agentId && !agentsMap.has(l.agentId)) {
        agentsMap.set(l.agentId, { id: l.agentId, type: Values.Person });
      }
    });

    // 头部 XML 组装
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

    // Agents
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

    // 标题
    metadata.title?.forEach((t) => {
      xmlLines.push(`      <ttm:title>${escapeXml(t)}</ttm:title>`);
    });

    // amll:meta 标签
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

    // iTunesMetadata 扩展（词曲作者与 Sidecar 翻译）
    const hasSongwriters = Boolean(metadata.songwriters && metadata.songwriters.length > 0);
    const transLines = normalizedLines.filter((l) => Boolean(l.translatedLyric));
    const romanLines = normalizedLines.filter((l) => Boolean(l.romanLyric));
    const hasSidecar = transLines.length > 0 || romanLines.length > 0 || hasSongwriters;

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
        xmlLines.push('          <translation xml:lang="zh-Hans">');
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
        xmlLines.push('          <transliteration xml:lang="ja-Latn">');
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

        // 单词序列
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

        // 背景人声
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
