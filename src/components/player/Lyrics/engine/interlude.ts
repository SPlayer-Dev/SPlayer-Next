/**
 * 歌词渲染引擎 — 间奏圆点动画
 *
 * 管理三个圆点的生命周期：入场缩放/淡入 → 呼吸动画 → 退场缩放/淡出。
 * 圆点依次点亮，呈现进度指示效果。
 */

import { clamp, easeInOutBack, easeOutExpo } from "../utils/math";
import type { LyricLine } from "@shared/types/lyrics";

/** 间奏检测结果：[起始时间, 结束时间, 前一行索引, 下一行是否为对唱] */
export type InterludeInfo = [number, number, number, boolean];

/**
 * 检测当前时间点是否处于间奏段
 *
 * 在当前激活行的前后各一行范围内搜索间奏间隙。
 *
 * @param currentTime - 当前播放时间（毫秒）
 * @param activeLineIndex - 当前激活行索引
 * @param lines - 歌词行数组
 * @param minInterludeGap - 触发间奏的最小间隔时长（毫秒）
 * @returns 间奏信息或 undefined
 */
export const detectInterlude = (
  currentTime: number,
  activeLineIndex: number,
  lines: LyricLine[],
  minInterludeGap: number,
): InterludeInfo | undefined => {
  const adjustedTime = currentTime + 20;

  const checkGap = (lineIndex: number): InterludeInfo | undefined => {
    if (lineIndex < -1 || lineIndex >= lines.length - 1) return undefined;
    const prevLine = lineIndex === -1 ? null : lines[lineIndex];
    const nextLine = lines[lineIndex + 1];
    const gapStart = prevLine ? prevLine.endTime : 0;
    const gapEnd = Math.max(gapStart, nextLine.startTime - 250);
    if (gapEnd - gapStart < minInterludeGap) return undefined;
    if (gapEnd > adjustedTime && gapStart < adjustedTime)
      return [gapStart, gapEnd, lineIndex, nextLine.isDuet];
    return undefined;
  };

  return (
    checkGap(activeLineIndex - 1) || checkGap(activeLineIndex) || checkGap(activeLineIndex + 1)
  );
};

/** 间奏圆点渲染器的状态 */
export interface InterludeState {
  /** 间奏是否激活 */
  isActive: boolean;
  /** 间奏起始时间（毫秒） */
  startTime: number;
  /** 间奏结束时间（毫秒） */
  endTime: number;
  /** 圆点 X 坐标 */
  x: number;
  /** 圆点 Y 坐标 */
  y: number;
  /** 圆点是否靠右对齐（对唱行前的间奏） */
  alignRight: boolean;
}

/** 间奏圆点渲染器的样式缓存 */
export interface InterludeCache {
  /** 上次写入的容器样式 */
  containerStyle: string;
  /** 上次写入的各圆点透明度 */
  dotOpacities: [string, string, string];
}

/**
 * 创建间奏圆点 DOM 结构
 *
 * @param parentElement - 父容器
 * @returns [圆点容器, 三个圆点元素]
 */
export const createInterludeDots = (
  parentElement: HTMLElement,
): [HTMLDivElement, [HTMLSpanElement, HTMLSpanElement, HTMLSpanElement]] => {
  const container = document.createElement("div");
  container.className = "lp-dots";
  const dot0 = document.createElement("span");
  const dot1 = document.createElement("span");
  const dot2 = document.createElement("span");
  container.append(dot0, dot1, dot2);
  parentElement.appendChild(container);
  return [container, [dot0, dot1, dot2]];
};

/**
 * 渲染间奏圆点动画
 *
 * 包含入场（缩放 + 淡入）、呼吸（正弦波缩放）和退场（回弹缩放 + 淡出）三个阶段
 *
 * @param currentTime - 当前播放时间（毫秒）
 * @param state - 间奏状态
 * @param dotsContainer - 圆点容器元素
 * @param dotElements - 三个圆点元素
 * @param cache - 样式缓存（避免冗余 DOM 写入）
 * @param breatheCycleTarget - 呼吸动画目标周期（毫秒）
 */
export const renderInterludeDots = (
  currentTime: number,
  state: InterludeState,
  dotsContainer: HTMLDivElement,
  dotElements: [HTMLSpanElement, HTMLSpanElement, HTMLSpanElement],
  cache: InterludeCache,
  breatheCycleTarget: number,
) => {
  if (!state.isActive) {
    if (cache.containerStyle !== "hide") {
      dotsContainer.style.opacity = "0";
      cache.containerStyle = "hide";
    }
    return;
  }

  const totalDuration = state.endTime - state.startTime;
  const elapsed = currentTime - state.startTime;

  if (elapsed < 0 || elapsed > totalDuration) {
    if (cache.containerStyle !== "hide") {
      dotsContainer.style.opacity = "0";
      cache.containerStyle = "hide";
    }
    return;
  }

  // 呼吸动画周期
  const breatheCycle = totalDuration / Math.ceil(totalDuration / breatheCycleTarget);

  let scale = 1;
  let opacity = 1;

  // 呼吸缩放（正弦波微调）
  scale *= Math.sin(1.5 * Math.PI - (elapsed / breatheCycle) * 2) / 20 + 1;

  // 入场缩放（指数缓出）
  if (elapsed < 2000) scale *= easeOutExpo(elapsed / 2000);

  // 入场淡入
  if (elapsed < 500) opacity = 0;
  else if (elapsed < 1000) opacity *= (elapsed - 500) / 500;

  // 退场动画
  const remaining = totalDuration - elapsed;
  if (remaining < 750) scale *= 1 - easeInOutBack((750 - remaining) / 750 / 2);
  if (remaining < 375) opacity *= clamp(0, remaining / 375, 1);

  scale = Math.max(0, scale);

  // 容器 transform
  const origin = state.alignRight ? "right center" : "left center";
  const transformStr = `translate(${state.x.toFixed(1)}px,${state.y.toFixed(1)}px) scale(${scale.toFixed(4)})`;
  const styleKey = transformStr + origin;
  if (cache.containerStyle !== styleKey) {
    cache.containerStyle = styleKey;
    dotsContainer.style.opacity = String(opacity);
    dotsContainer.style.transform = transformStr;
    dotsContainer.style.transformOrigin = origin;
  }

  // 各圆点透明度
  const activeDuration = Math.max(0, totalDuration - 750);
  const newOpacities: [string, string, string] = [
    String(clamp(0, opacity * clamp(0.25, ((elapsed * 3) / activeDuration) * 0.75, 1), 1)),
    String(
      clamp(
        0,
        opacity * clamp(0.25, (((elapsed - activeDuration / 3) * 3) / activeDuration) * 0.75, 1),
        1,
      ),
    ),
    String(
      clamp(
        0,
        opacity *
          clamp(0.25, (((elapsed - (activeDuration / 3) * 2) * 3) / activeDuration) * 0.75, 1),
        1,
      ),
    ),
  ];

  for (let i = 0; i < 3; i++) {
    if (cache.dotOpacities[i] !== newOpacities[i]) {
      cache.dotOpacities[i] = newOpacities[i];
      dotElements[i].style.opacity = newOpacities[i];
    }
  }
};
