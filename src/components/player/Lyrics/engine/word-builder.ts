/**
 * 歌词渲染引擎 — 单词 span 构建与掩码测量
 */

import { chunkAndSplitLyricWords } from "../utils/split-words";
import type { LyricLine, LyricWord } from "@shared/types/lyrics";
import { needsSpaceBetween } from "../utils/split-words";
import { shouldChunkEmphasize } from "./emphasize";

/** 单个歌词单词的 DOM 元素与测量数据 */
export interface WordMeasurement {
  /** 对应的 span 元素 */
  element: HTMLSpanElement;
  /** 歌词单词数据 */
  word: LyricWord;
  /** 元素宽度（px） */
  width: number;
  /** 渐变区域宽度（px） */
  fadeWidth: number;
}

/** 描述一个需要动画的单词（用于懒创建动画） */
export interface WordAnimTarget {
  /** 应用 float 动画的元素 */
  element: HTMLElement;
  /** 时间数据 */
  word: LyricWord;
  /** 是否为强调词 */
  isEmphasize: boolean;
  /** 强调词的字符级 span（非强调词为空数组） */
  charElements: HTMLElement[];
  /** 是否为行末单词 */
  isLastWord: boolean;
}

/** buildWordSpans 的返回结果 */
export interface BuildResult {
  measurements: WordMeasurement[];
  /** 懒创建动画所需的目标描述 */
  animTargets: WordAnimTarget[];
}

/**
 * 构建单词 span 元素并添加到主容器（纯 DOM 构建，不创建动画）
 */
export const buildWordSpans = (
  words: LyricWord[],
  mainDiv: HTMLDivElement,
  enableEmphasize = true,
): BuildResult => {
  const chunks = chunkAndSplitLyricWords(words);
  const measurements: WordMeasurement[] = [];
  const animTargets: WordAnimTarget[] = [];

  const hasWhitespaceInfo = chunks.some((chunk) => {
    if (Array.isArray(chunk)) {
      return chunk.some((word) => word.word !== word.word.trim());
    }
    return chunk.word !== chunk.word.trim();
  });

  const nonEmptyChunks: (LyricWord | LyricWord[])[] = chunks.filter((c) =>
    Array.isArray(c) ? c.some((w) => w.word.trim()) : c.word.trim(),
  );
  const lastChunk = nonEmptyChunks[nonEmptyChunks.length - 1];

  if (!hasWhitespaceInfo) {
    let previousText = "";
    for (const chunk of chunks) {
      const atoms = Array.isArray(chunk) ? chunk : [chunk];
      const isEmp = enableEmphasize && atoms.length > 0 && shouldChunkEmphasize(atoms);
      const isLast = chunk === lastChunk;

      const firstText = atoms[0]?.word.trim();
      if (firstText && needsSpaceBetween(previousText, firstText)) {
        mainDiv.appendChild(document.createTextNode(" "));
      }

      if (isEmp) {
        buildEmphasizedChunk(atoms, mainDiv, measurements, animTargets, isLast);
      } else {
        for (const atom of atoms) {
          const text = atom.word.trim();
          if (!text) continue;
          const span = document.createElement("span");
          span.textContent = text;
          mainDiv.appendChild(span);
          measurements.push({ element: span, word: atom, width: 0, fadeWidth: 0 });
          animTargets.push({
            element: span,
            word: atom,
            isEmphasize: false,
            charElements: [],
            isLastWord: false,
          });
        }
      }
      const lastAtom = atoms[atoms.length - 1];
      if (lastAtom) previousText = lastAtom.word.trim();
    }
    return { measurements, animTargets };
  }

  // 正常路径
  let previousText = "";

  for (const chunk of chunks) {
    if (Array.isArray(chunk)) {
      const mergedText = chunk.map((word) => word.word).join("");
      const isEmp = enableEmphasize && shouldChunkEmphasize(chunk);
      const isLast = chunk === lastChunk;

      if (mergedText.trimStart() !== mergedText) {
        mainDiv.appendChild(document.createTextNode(" "));
      } else if (needsSpaceBetween(previousText, mergedText)) {
        mainDiv.appendChild(document.createTextNode(" "));
      }

      if (isEmp) {
        buildEmphasizedChunk(chunk, mainDiv, measurements, animTargets, isLast);
      } else {
        for (const word of chunk) {
          const span = document.createElement("span");
          span.textContent = word.word;
          mainDiv.appendChild(span);
          measurements.push({ element: span, word, width: 0, fadeWidth: 0 });
          animTargets.push({
            element: span,
            word,
            isEmphasize: false,
            charElements: [],
            isLastWord: false,
          });
        }
      }

      if (mergedText.trimEnd() !== mergedText) {
        mainDiv.appendChild(document.createTextNode(" "));
        previousText = "";
      } else {
        previousText = mergedText;
      }
    } else if (!chunk.word.trim()) {
      mainDiv.appendChild(document.createTextNode(" "));
      previousText = "";
    } else {
      const text = chunk.word;
      const isEmp = enableEmphasize && shouldChunkEmphasize([chunk]);
      const isLast = chunk === lastChunk;

      if (text.trimStart() !== text) {
        mainDiv.appendChild(document.createTextNode(" "));
      } else if (needsSpaceBetween(previousText, text)) {
        mainDiv.appendChild(document.createTextNode(" "));
      }

      if (isEmp) {
        buildEmphasizedChunk([chunk], mainDiv, measurements, animTargets, isLast);
      } else {
        const span = document.createElement("span");
        span.textContent = text.trim();
        mainDiv.appendChild(span);
        measurements.push({ element: span, word: chunk, width: 0, fadeWidth: 0 });
        animTargets.push({
          element: span,
          word: chunk,
          isEmphasize: false,
          charElements: [],
          isLastWord: false,
        });
      }

      if (text.trimEnd() !== text) {
        mainDiv.appendChild(document.createTextNode(" "));
        previousText = "";
      } else {
        previousText = text.trim();
      }
    }
  }
  return { measurements, animTargets };
};

/**
 * 构建强调单词 chunk（纯 DOM，不创建动画）
 */
function buildEmphasizedChunk(
  atoms: LyricWord[],
  mainDiv: HTMLDivElement,
  measurements: WordMeasurement[],
  animTargets: WordAnimTarget[],
  isLastWord: boolean,
) {
  const mergedWord: LyricWord = {
    word: atoms.map((a) => a.word).join(""),
    startTime: Math.min(...atoms.map((a) => a.startTime)),
    endTime: Math.max(...atoms.map((a) => a.endTime)),
  };
  const trimmed = mergedWord.word.trim();

  const wrapper = document.createElement("span");
  wrapper.className = "lp-emp-wrapper";

  const charElements: HTMLElement[] = [];
  for (const char of trimmed) {
    const charSpan = document.createElement("span");
    charSpan.textContent = char;
    wrapper.appendChild(charSpan);
    charElements.push(charSpan);
  }

  mainDiv.appendChild(wrapper);
  measurements.push({ element: wrapper, word: mergedWord, width: 0, fadeWidth: 0 });
  animTargets.push({
    element: wrapper,
    word: mergedWord,
    isEmphasize: true,
    charElements,
    isLastWord,
  });
}

/**
 * 测量所有单词的宽度并设置 CSS 掩码
 *
 * 采用读写分离策略：第一遍批量读取所有 DOM 尺寸（触发一次回流），
 * 第二遍批量写入所有 CSS mask 样式（零回流），避免逐词读写交替导致的 N 次强制回流。
 */
export const measureAndApplyWordMasks = (
  wordMeasurements: WordMeasurement[][],
  fadeRatio: number,
  lines?: LyricLine[],
) => {
  // 临时存储每个 measurement 的 padding，供第二遍使用
  const paddings: number[][] = new Array(wordMeasurements.length);

  // ===== 第一遍：批量读取 DOM 尺寸（一次回流） =====
  for (let i = 0; i < wordMeasurements.length; i++) {
    const lineMeasurements = wordMeasurements[i];
    if (!lineMeasurements) {
      paddings[i] = [];
      continue;
    }
    paddings[i] = new Array(lineMeasurements.length);
    for (let j = 0; j < lineMeasurements.length; j++) {
      const m = lineMeasurements[j];
      const el = m.element;
      const padding = el.classList.contains("lp-emp-wrapper")
        ? Number.parseFloat(getComputedStyle(el).paddingLeft) || 0
        : 0;
      paddings[i][j] = padding;
      m.width = (el.clientWidth || 1) - padding * 2;
      m.fadeWidth = ((el.clientHeight || 16) - padding * 2) * fadeRatio;
    }
  }

  // ===== 第二遍：批量写入 CSS mask 样式（零回流） =====
  for (let i = 0; i < wordMeasurements.length; i++) {
    const lineMeasurements = wordMeasurements[i];
    const lineStart = lines?.[i]?.startTime ?? 0;
    if (!lineMeasurements) continue;
    for (let j = 0; j < lineMeasurements.length; j++) {
      const measurement = lineMeasurements[j];
      const padding = paddings[i][j];
      const elementWidth = measurement.width;
      const gradientWidth = measurement.fadeWidth;
      const totalAspect = 2 + gradientWidth / elementWidth;
      const gradientRatio = gradientWidth / elementWidth / totalAspect;
      const gradientStart = (1 - gradientRatio) / 2;
      const maskImage = `linear-gradient(to right,rgba(0,0,0,var(--ba)) ${gradientStart * 100}%,rgba(0,0,0,var(--da)) ${(gradientStart + gradientRatio) * 100}%)`;
      const maskPixelWidth = totalAspect * elementWidth;
      const maskSize = `${maskPixelWidth}px 100%`;
      const wordData = measurement.word;
      const totalMaskWidth = elementWidth + gradientWidth;
      const wordDuration = Math.abs(wordData.endTime - wordData.startTime) || 1;
      // preRoll：在 startTime 之前提前开始扫动，让相邻词亮区衔接而非硬切
      const preRoll = Math.min(80, wordDuration * 0.3);
      const adjustedStart = Math.max(lineStart, wordData.startTime - preRoll);
      const adjustedDuration = Math.max(1, wordData.endTime - adjustedStart);
      const startPos = padding - totalMaskWidth;
      const endPos = padding;
      const speed = totalMaskWidth / adjustedDuration;
      const maskPosition = Number.isFinite(speed)
        ? `clamp(${startPos}px,calc(${startPos}px + (var(--t,${lineStart}) - ${adjustedStart}) * ${speed}px),${endPos}px) 0px,left top`
        : `${startPos}px 0px,left top`;
      const style = measurement.element.style;
      style.setProperty("mask-image", maskImage);
      style.setProperty("mask-size", maskSize);
      style.setProperty("mask-repeat", "no-repeat");
      style.setProperty("mask-position", maskPosition);
    }
  }
};
