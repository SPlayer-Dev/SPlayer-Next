/**
 * TTML AST 与扁平化歌词数据结构转换器
 * 提供符合 AMLL 规范的降级转换、双向反转以及针对 SPlayer-Next 渲染体系的增强转换
 */

import type { LyricLine as SPlayerLyricLine, LyricResult } from "@shared/types/lyrics";
import { Elements, Values } from "./constants";
import { pickBestLanguageIndex } from "./pickLanguage";
import type {
  AmllLyricLine,
  AmllLyricResult,
  AmllLyricWord,
  AmllMetadata,
  AmllToTTMLOptions,
  LyricBase,
  LyricLine,
  ParseTTMLOptions,
  Syllable,
  TTMLMetadata,
  TTMLResult,
  TTMLToAmllOptions,
} from "./types";

/**
 * 将 TTMLResult 转换为 AMLL 扁平化数据结构
 * @param result - TTML AST 结果
 * @param options - 转换选项
 * @returns AMLL 歌词结果
 */
export function toAmllLyrics(result: TTMLResult, options?: TTMLToAmllOptions): AmllLyricResult {
  const amllLines: AmllLyricLine[] = [];

  const convertToAmllLine = (source: LyricBase, isBG: boolean, isDuet: boolean): AmllLyricLine => {
    let amllWords: AmllLyricWord[] = [];

    if (source.words && source.words.length > 0) {
      amllWords = source.words.map((w) => {
        let wordText = w.text + (w.endsWithSpace ? " " : "");
        if (isBG && options?.stripBackgroundParens) {
          wordText = wordText.replace(/^[(（]+/, "").replace(/[)）]+$/, "");
        }

        const amllWord: AmllLyricWord = {
          startTime: w.startTime,
          endTime: w.endTime,
          word: wordText,
          romanWord: "",
          obscene: w.obscene,
          emptyBeat: w.emptyBeat,
        };

        if (w.ruby && w.ruby.length > 0) {
          amllWord.ruby = w.ruby.map((r) => ({
            startTime: r.startTime,
            endTime: r.endTime,
            word: r.text,
          }));
        }

        return amllWord;
      });
    } else {
      let sourceText = source.text;
      if (isBG && options?.stripBackgroundParens) {
        sourceText = sourceText.replace(/^[(（]+/, "").replace(/[)）]+$/, "");
      }
      amllWords = [
        {
          startTime: source.startTime,
          endTime: source.endTime,
          word: sourceText,
          romanWord: "",
        },
      ];
    }

    let transText = "";
    if (source.translations && source.translations.length > 0) {
      const idx = pickBestLanguageIndex(
        source.translations.map((t) => t.language),
        options?.translationLanguage,
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
        options?.romanizationLanguage,
      );
      if (idx !== -1 && source.romanizations[idx]) {
        const targetRoman = source.romanizations[idx];
        romanWords = targetRoman.words;
        if (!romanWords || romanWords.length === 0) {
          romanText = targetRoman.text;
        }
      }
    }

    if (romanWords && amllWords.length > 0) {
      alignRomanization(amllWords, romanWords);
    }

    return {
      words: amllWords,
      translatedLyric: transText,
      romanLyric: romanText,
      isBG,
      isDuet,
      startTime: source.startTime,
      endTime: source.endTime,
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

    // Apple Music 规范对唱判定逻辑
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

    const amllMain = convertToAmllLine(line, false, currentIsDuet);
    amllLines.push(amllMain);

    if (line.backgroundVocal) {
      const simpleBg = convertToAmllLine(line.backgroundVocal, true, currentIsDuet);
      amllLines.push(simpleBg);
    }
  }

  const amllMetadata: [string, string[]][] = [];
  const meta = result.metadata;

  if (meta.title) amllMetadata.push([Values.MusicName, meta.title]);
  if (meta.artist) amllMetadata.push([Values.Artists, meta.artist]);
  if (meta.album) amllMetadata.push([Values.Album, meta.album]);
  if (meta.isrc) amllMetadata.push([Values.ISRC, meta.isrc]);
  if (meta.authorIds) amllMetadata.push([Values.TTMLAuthorGithub, meta.authorIds]);
  if (meta.authorNames) amllMetadata.push([Values.TTMLAuthorGithubLogin, meta.authorNames]);

  if (meta.language) amllMetadata.push([Values.Language, [meta.language]]);
  if (meta.timingMode) amllMetadata.push([Values.TimingMode, [meta.timingMode]]);
  if (meta.songwriters) amllMetadata.push([Elements.Songwriters, meta.songwriters]);

  if (meta.platformIds) {
    if (meta.platformIds.ncmMusicId)
      amllMetadata.push([Values.NCMMusicId, meta.platformIds.ncmMusicId]);
    if (meta.platformIds.qqMusicId)
      amllMetadata.push([Values.QQMusicId, meta.platformIds.qqMusicId]);
    if (meta.platformIds.spotifyId)
      amllMetadata.push([Values.SpotifyId, meta.platformIds.spotifyId]);
    if (meta.platformIds.appleMusicId)
      amllMetadata.push([Values.AppleMusicId, meta.platformIds.appleMusicId]);
  }

  if (meta.rawProperties) {
    for (const [key, value] of Object.entries(meta.rawProperties)) {
      amllMetadata.push([key, value]);
    }
  }

  return {
    lines: amllLines,
    metadata: amllMetadata,
  };
}

/**
 * 将 TTMLResult 转换为适配 SPlayer-Next 渲染体系的 LyricResult
 * 完整透传 songPart、blockIndex、id、agentId 等元属性，并规范填充 authors
 * @param result - TTML AST 结果
 * @param options - 解析转换选项
 * @returns SPlayer-Next 歌词对象
 */
export function toSPlayerLyricResult(
  result: TTMLResult,
  options: ParseTTMLOptions = {},
): LyricResult {
  const preferredLang = options.preferredLang || options.translationLanguage;
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
      words = source.words.map((w) => ({
        startTime: w.startTime,
        endTime: w.endTime,
        word: w.text,
        romanWord: "",
        obscene: w.obscene,
        emptyBeat: w.emptyBeat,
        endsWithSpace: w.endsWithSpace,
        ruby: w.ruby?.map((r) => ({
          startTime: r.startTime,
          endTime: r.endTime,
          word: r.text,
        })),
      }));
    } else {
      words = [
        {
          startTime: source.startTime,
          endTime: source.endTime,
          word: source.text,
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

  // 整理制作者元数据
  const meta = result.metadata;
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
 * 逐字罗马音双指针滑动窗口对齐
 * @param amllWords - 主歌词单词列表
 * @param romanWords - 音译逐字片段
 */
function alignRomanization(
  amllWords: Array<{ startTime: number; endTime: number; romanWord?: string }>,
  romanWords: Syllable[],
): void {
  let romanSearchStartIndex = 0;
  const MIN_IOU_THRESHOLD = 0.1;
  const FAST_TRACK_TOLERANCE_MS = 2;

  for (let i = 0; i < amllWords.length; i++) {
    const main = amllWords[i];
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

/**
 * 将 AMLL 扁平化数据反向转换为 TTMLResult
 * @param amllLines - AMLL 歌词行
 * @param amllMetadata - AMLL 元数据键值对列表
 * @param options - 转换选项
 * @returns TTMLResult AST
 */
export function toTTMLResult(
  amllLines: AmllLyricLine[],
  amllMetadata: AmllMetadata[] = [],
  options: AmllToTTMLOptions = {},
): TTMLResult {
  const opts = {
    translationLanguage: "zh-Hans",
    ...options,
  };

  const metadata: TTMLMetadata = {
    agents: {
      [Values.AgentDefault]: { id: Values.AgentDefault },
      [Values.AgentDefaultDuet]: { id: Values.AgentDefaultDuet },
    },
  };

  for (const entry of amllMetadata) {
    const [key, value] = entry;
    if (!value || value.length === 0) continue;

    switch (key) {
      case Values.MusicName:
        metadata.title = value;
        break;
      case Values.Artists:
        metadata.artist = value;
        break;
      case Values.Album:
        metadata.album = value;
        break;
      case Values.ISRC:
        metadata.isrc = value;
        break;
      case Values.TTMLAuthorGithub:
        metadata.authorIds = value;
        break;
      case Values.TTMLAuthorGithubLogin:
        metadata.authorNames = value;
        break;
      case Values.NCMMusicId:
      case Values.QQMusicId:
      case Values.SpotifyId:
      case Values.AppleMusicId:
        metadata.platformIds ??= {};
        metadata.platformIds[key] = value;
        break;
      default:
        metadata.rawProperties ??= {};
        metadata.rawProperties[key] = value;
        break;
    }
  }

  const resultLines: LyricLine[] = [];
  let currentMainLine: LyricLine | null = null;

  for (const amllLine of amllLines) {
    const { mainSyllables, romanSyllables, fullText, romanText } = convertWords(amllLine);

    const lyricBase: LyricBase = {
      startTime: amllLine.startTime,
      endTime: amllLine.endTime,
      text: fullText,
      words: mainSyllables,
    };

    if (amllLine.translatedLyric) {
      lyricBase.translations = [
        {
          language: opts.translationLanguage,
          text: amllLine.translatedLyric,
        },
      ];
    }

    if (amllLine.romanLyric || romanSyllables.length > 0) {
      lyricBase.romanizations = [
        {
          language: opts.romanizationLanguage,
          text: amllLine.romanLyric || romanText,
          words: romanSyllables.length > 0 ? romanSyllables : undefined,
        },
      ];
    }

    if (amllLine.isBG) {
      if (currentMainLine && !currentMainLine.backgroundVocal) {
        currentMainLine.backgroundVocal = lyricBase;
      } else {
        const inheritedAgentId = currentMainLine ? currentMainLine.agentId : Values.AgentDefault;

        const promotedLine: LyricLine = {
          agentId: inheritedAgentId,
          ...lyricBase,
        };
        resultLines.push(promotedLine);
      }
    } else {
      const agentId = amllLine.isDuet ? Values.AgentDefaultDuet : Values.AgentDefault;
      const lyricLine: LyricLine = {
        agentId,
        ...lyricBase,
      };

      resultLines.push(lyricLine);
      currentMainLine = lyricLine;
    }
  }

  return {
    metadata,
    lines: resultLines,
  };
}

function convertWords(amllLine: AmllLyricLine): {
  mainSyllables: Syllable[];
  romanSyllables: Syllable[];
  fullText: string;
  romanText: string;
} {
  const mainSyllables: Syllable[] = [];
  const romanSyllables: Syllable[] = [];

  for (const word of amllLine.words) {
    const rawText = word.word;
    const trimmedText = rawText.trimEnd();
    const hasSpace = rawText !== trimmedText;

    const syllable: Syllable = {
      text: trimmedText,
      startTime: word.startTime,
      endTime: word.endTime,
      endsWithSpace: hasSpace,
      obscene: word.obscene,
      emptyBeat: word.emptyBeat,
    };

    if (word.ruby && word.ruby.length > 0) {
      syllable.ruby = word.ruby.map((r) => ({
        startTime: r.startTime,
        endTime: r.endTime,
        text: r.word,
      }));
    }

    mainSyllables.push(syllable);

    if (word.romanWord) {
      romanSyllables.push({
        text: word.romanWord.trim(),
        startTime: word.startTime,
        endTime: word.endTime,
      });
    }
  }

  const fullText = amllLine.words.map((w) => w.word).join("");
  const romanText =
    romanSyllables.length > 0
      ? romanSyllables.map((s) => s.text + (s.endsWithSpace ? " " : "")).join("")
      : "";

  return { mainSyllables, romanSyllables, fullText, romanText };
}
