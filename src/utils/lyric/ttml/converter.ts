/**
 * TTML AST 转 SPlayer-Next 歌词数据结构转换器
 */

import type { LyricLine as SPlayerLyricLine, LyricResult } from "@shared/types/lyrics";
import { Values } from "./constants";
import { pickBestLanguageIndex } from "./pickLanguage";
import type { LyricBase, ParseTTMLOptions, Syllable, TTMLResult } from "./types";

/**
 * 将 TTMLResult AST 转换为适配 SPlayer-Next 渲染体系的 LyricResult
 * 完整透传 songPart、blockIndex、id、agentId 等元属性，并规范填充 authors
 * @param result - TTML AST 结果
 * @param options - 解析转换选项
 * @returns SPlayer-Next 统一歌词对象
 */
export function toSPlayerLyricResult(
  result: TTMLResult,
  options: ParseTTMLOptions = {},
): LyricResult {
  const preferredLang = options.preferredLang || options.translationLanguage;
  const stripParens = options.stripBackgroundParens ?? true;
  const splayerLines: SPlayerLyricLine[] = [];

  const convertLine = (
    source: LyricBase,
    isBG: boolean,
    isDuet: boolean,
    id?: string,
    agentId?: string,
    songPart?: string,
    blockIndex?: number,
  ): SPlayerLyricLine => {
    let words: SPlayerLyricLine["words"] = [];

    if (source.words && source.words.length > 0) {
      words = source.words.map((w) => {
        let text = w.text;
        if (isBG && stripParens) {
          text = text.replace(/^[(（]+/, "").replace(/[)）]+$/, "");
        }
        const wordText = text + (w.endsWithSpace ? " " : "");
        return {
          startTime: w.startTime,
          endTime: w.endTime,
          word: wordText,
          romanWord: "",
          obscene: w.obscene,
          emptyBeat: w.emptyBeat,
          endsWithSpace: w.endsWithSpace,
          ruby: w.ruby?.map((r) => ({
            startTime: r.startTime,
            endTime: r.endTime,
            word: r.text,
          })),
        };
      });
    } else {
      let text = source.text;
      if (isBG && stripParens) {
        text = text.replace(/^[(（]+/, "").replace(/[)）]+$/, "");
      }
      words = [
        {
          startTime: source.startTime,
          endTime: source.endTime,
          word: text,
          romanWord: "",
        },
      ];
    }

    let transText = "";
    if (source.translations && source.translations.length > 0) {
      const idx = pickBestLanguageIndex(
        source.translations.map((t) => t.language),
        preferredLang,
      );
      if (idx !== -1 && source.translations[idx]) {
        transText = source.translations[idx].text;
      }
    }

    let romanText = "";
    let romanWords: Syllable[] | undefined;
    if (source.romanizations && source.romanizations.length > 0) {
      const idx = pickBestLanguageIndex(
        source.romanizations.map((r) => r.language),
        options.romanizationLanguage,
      );
      if (idx !== -1 && source.romanizations[idx]) {
        const targetRoman = source.romanizations[idx];
        romanWords = targetRoman.words;
        if (!romanWords || romanWords.length === 0) {
          romanText = targetRoman.text;
        }
      }
    }

    if (romanWords && words.length > 0) {
      alignRomanization(words, romanWords);
    }

    return {
      id,
      words,
      translatedLyric: transText,
      romanLyric: romanText,
      startTime: source.startTime,
      endTime: source.endTime,
      isBG,
      isDuet,
      agentId,
      songPart,
      blockIndex,
    };
  };

  let lastPersonAgentId: string | null = null;
  let lastPersonIsDuet: boolean = false;

  for (const line of result.lines) {
    const agentId = line.agentId || Values.AgentDefault;
    const agent = result.metadata.agents?.[agentId];
    const isGroup = agent?.type === Values.Group;
    const isOther = agent?.type === Values.Other;

    let currentIsDuet = false;

    // 针对对唱歌词的左右对齐判定：
    // 当前播放器 UI 仅设左右双侧排版槽位（左侧主唱 isDuet: false，右侧对唱 isDuet: true，群唱居中）。
    // 当存在 3 位及以上 Person 角色交替演唱时，采用声部切换左右翻转策略；
    // 同时保留原始 agentId 透传至各行，确保声部元数据不丢失。
    if (isGroup) {
      currentIsDuet = false;
    } else if (lastPersonAgentId === null) {
      currentIsDuet = Boolean(isOther);
      lastPersonAgentId = agentId;
      lastPersonIsDuet = currentIsDuet;
    } else if (lastPersonAgentId === agentId) {
      currentIsDuet = lastPersonIsDuet;
    } else {
      currentIsDuet = !lastPersonIsDuet;
      lastPersonAgentId = agentId;
      lastPersonIsDuet = currentIsDuet;
    }

    const mainLine = convertLine(
      line,
      false,
      currentIsDuet,
      line.id,
      line.agentId,
      line.songPart,
      line.blockIndex,
    );
    splayerLines.push(mainLine);

    if (line.backgroundVocal) {
      const bgLine = convertLine(
        line.backgroundVocal,
        true,
        currentIsDuet,
        line.id ? `${line.id}-bg` : undefined,
        line.agentId,
        line.songPart,
        line.blockIndex,
      );
      splayerLines.push(bgLine);
    }
  }

  // 提取元数据
  const meta = result.metadata;
  const shouldExtractMeta = options.extractMetadata !== false;
  if (!shouldExtractMeta) {
    return {
      lines: splayerLines,
      metadata: {},
    };
  }

  const authorSet = new Set<string>();
  meta.authorNames?.forEach((name) => {
    if (name.trim()) authorSet.add(name.trim());
  });
  meta.authorIds?.forEach((id) => {
    const parts = id.trim().split("/");
    const username = parts[parts.length - 1] || id.trim();
    if (username) authorSet.add(username);
  });

  return {
    lines: splayerLines,
    metadata: {
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      isrc: meta.isrc,
      authors: Array.from(authorSet),
      authorIds: meta.authorIds,
      authorNames: meta.authorNames,
      songwriters: meta.songwriters,
      timingMode: meta.timingMode,
      agents: meta.agents,
      platformIds: meta.platformIds,
      rawProperties: meta.rawProperties,
      offset: meta.offset,
    },
  };
}

/**
 * 逐字罗马音双指针滑动窗口对齐算法
 * @param mainWords - 主歌词逐字列表
 * @param romanWords - 音译逐字片段序列
 */
export function alignRomanization(
  mainWords: Array<{ startTime: number; endTime: number; romanWord?: string }>,
  romanWords: Syllable[],
): void {
  let romanSearchStartIndex = 0;
  const MIN_IOU_THRESHOLD = 0.1;
  const FAST_TRACK_TOLERANCE_MS = 2;

  for (let i = 0; i < mainWords.length; i++) {
    const main = mainWords[i];
    const mainEndTime = main.endTime;

    let maxIou = 0;
    let bestMatchIndex = -1;
    let isFastTrackMatched = false;

    let j = romanSearchStartIndex;
    while (j < romanWords.length) {
      const sub = romanWords[j];

      if (Math.abs(main.startTime - sub.startTime) <= FAST_TRACK_TOLERANCE_MS) {
        main.romanWord = sub.text;
        romanSearchStartIndex = j + 1;
        isFastTrackMatched = true;
        break;
      }

      const subEndTime = sub.endTime;
      const overlapStart = Math.max(main.startTime, sub.startTime);
      const overlapEnd = Math.min(mainEndTime, subEndTime);
      const intersection = Math.max(0, overlapEnd - overlapStart);

      if (intersection > 0) {
        const unionStart = Math.min(main.startTime, sub.startTime);
        const unionEnd = Math.max(mainEndTime, subEndTime);
        const unionDuration = Math.max(1, unionEnd - unionStart);
        const iou = intersection / unionDuration;

        if (iou > maxIou) {
          maxIou = iou;
          bestMatchIndex = j;
        }
      }

      if (sub.startTime >= mainEndTime) {
        break;
      }
      j++;
    }

    if (!isFastTrackMatched && bestMatchIndex !== -1 && maxIou >= MIN_IOU_THRESHOLD) {
      main.romanWord = romanWords[bestMatchIndex].text;
      romanSearchStartIndex = bestMatchIndex + 1;
    }
  }
}
