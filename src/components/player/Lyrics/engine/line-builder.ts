/**
 * 歌词渲染引擎 — 歌词行 DOM 构建
 */

import type { LyricLine } from "@shared/types/lyrics";
import { buildWordSpans, type WordMeasurement, type WordAnimTarget } from "./word-builder";

/** 行 DOM 构建选项 */
export interface LineBuildOptions {
  /** 是否启用强调效果（影响 span 结构） */
  enableEmphasizeEffect: boolean;
  /** 是否显示翻译歌词 */
  showTranslation: boolean;
  /** 是否显示音译歌词 */
  showRomanization: boolean;
}

/** 行 DOM 构建结果 */
export interface LineBuildResult {
  /** 每行对应的 DOM 元素 */
  lineElements: HTMLDivElement[];
  /** 每行的单词测量数据（用于 CSS mask 计算） */
  wordMeasurements: WordMeasurement[][];
  /** 每行的动画目标描述（懒创建动画的依据） */
  lineAnimTargets: WordAnimTarget[][];
  /** 标记背景人声行是否应置于主行上方 */
  isBgAbove: boolean[];
  /** 装载所有行元素的文档片段 */
  fragment: DocumentFragment;
}

/**
 * 构建全部歌词行的 DOM 元素与关联元数据
 * @param lines - 歌词行数组
 * @param options - 构建选项
 * @returns 行元素、测量数据、动画目标与置顶背景行标记
 */
export const buildLineElements = (
  lines: LyricLine[],
  options: LineBuildOptions,
): LineBuildResult => {
  const lineCount = lines.length;
  const lineElements: HTMLDivElement[] = new Array(lineCount);
  const wordMeasurements: WordMeasurement[][] = new Array(lineCount);
  const lineAnimTargets: WordAnimTarget[][] = new Array(lineCount);
  const isBgAbove: boolean[] = new Array(lineCount).fill(false);

  // 是否视为逐字
  const hasMultiWordLine = lines.some((line) => line.words.length > 1);

  // 背景人声行：首词早于主行则置于主行上方
  for (let i = 1; i < lineCount; i++) {
    const bg = lines[i];
    const main = lines[i - 1];
    if (!bg.isBG || main.isBG) continue;
    const bgStart = bg.words[0]?.startTime ?? bg.startTime;
    const mainStart = main.words[0]?.startTime ?? main.startTime;
    isBgAbove[i] = bgStart < mainStart;
  }

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < lineCount; i++) {
    const line = lines[i];
    const lineEl = document.createElement("div");
    lineEl.className = "lp-line" + (line.isDuet ? " duet" : "") + (line.isBG ? " bg" : "");
    const mainDiv = document.createElement("div");
    mainDiv.className = "lp-main";

    // 行歌词是否静态（≤1 个单词，无逐字动画）
    const isStatic = line.words.length === 0 || (line.words.length === 1 && !hasMultiWordLine);

    if (isStatic) {
      mainDiv.appendChild(document.createTextNode(line.words.map((w) => w.word).join("")));
      // 给静态行也加统一 mask，让 --ba 对其生效，与逐字行透明度一致
      mainDiv.style.setProperty(
        "mask-image",
        "linear-gradient(rgba(0,0,0,var(--ba)),rgba(0,0,0,var(--ba)))",
      );
      wordMeasurements[i] = [];
      lineAnimTargets[i] = [];
    } else {
      // 构建单词 span + 动画目标描述
      const result = buildWordSpans(line.words, mainDiv, options.enableEmphasizeEffect);
      wordMeasurements[i] = result.measurements;
      lineAnimTargets[i] = result.animTargets;
    }

    // 内容包裹层
    const contentDiv = document.createElement("div");
    contentDiv.className = "lp-content";
    contentDiv.appendChild(mainDiv);

    if (options.showTranslation && line.translatedLyric) {
      const subDiv = document.createElement("div");
      subDiv.className = "lp-sub";
      subDiv.textContent = line.translatedLyric;
      contentDiv.appendChild(subDiv);
    }
    if (options.showRomanization && line.romanLyric) {
      const subDiv = document.createElement("div");
      subDiv.className = "lp-sub";
      subDiv.textContent = line.romanLyric;
      contentDiv.appendChild(subDiv);
    }

    lineEl.appendChild(contentDiv);
    lineElements[i] = lineEl;
    fragment.appendChild(lineEl);
  }

  return { lineElements, wordMeasurements, lineAnimTargets, isBgAbove, fragment };
};
