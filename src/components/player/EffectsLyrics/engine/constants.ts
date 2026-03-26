/**
 * 歌词渲染引擎
 * 类型定义与默认配置
 */

import type { SpringParams } from "./spring";

export const DEFAULTS = {
  /** 用户滚动后自动回弹的延迟时间（毫秒） */
  scrollResetDelay: 5000,
  /** 触发间奏动画的最小间隔时长（毫秒） */
  minInterludeGap: 4000,
  /** 间奏圆点呼吸动画的目标周期（毫秒） */
  breatheCycleTarget: 1500,
  /** 透明度增加速度（激活时） */
  alphaAttackSpeed: 50,
  /** 透明度衰减速度（取消激活时） */
  alphaReleaseSpeed: 7,
  /** 非激活行的基础透明度 */
  inactiveAlpha: 0.2,
  /** 激活行在容器中的对齐位置（0~1） */
  alignPosition: 0.35,
  /** 逐字掩码渐变宽度比例 */
  wordFadeWidth: 0.5,
  /** 是否隐藏已播放行 */
  hidePassedLines: false,
  /** 是否启用逐行模糊效果 */
  enableBlur: false,
  /** 是否启用逐字高亮效果 */
  enableWordHighlight: true,
  /** 是否启用逐字上浮动画 */
  enableFloatAnimation: false,
  /** 是否启用强调效果：缩放 + 辉光 + 正弦浮动 */
  enableEmphasizeEffect: false,
};

/** 渲染器配置 */
export interface RendererConfig {
  /** 激活行在容器中的对齐位置（0~1，0.35 表示距顶部 35%） */
  alignPosition: number;
  /** 是否正在播放 */
  playing: boolean;
  /** 弹簧物理参数 */
  springConfig: Partial<SpringParams>;
  /** 逐字掩码渐变宽度比例 */
  wordFadeWidth: number;
  /** 用户滚动后自动回弹的延迟时间（毫秒，默认 5000） */
  scrollResetDelay: number;
  /** 触发间奏动画的最小间隔时长（毫秒，默认 4000） */
  minInterludeGap: number;
  /** 间奏圆点呼吸动画的目标周期（毫秒，默认 1500） */
  breatheCycleTarget: number;
  /** 透明度增加速度（激活时，默认 50） */
  alphaAttackSpeed: number;
  /** 透明度衰减速度（取消激活时，默认 7） */
  alphaReleaseSpeed: number;
  /** 非激活行的基础透明度（默认 0.2） */
  inactiveAlpha: number;
  /** 是否隐藏已播放行（默认 false） */
  hidePassedLines: boolean;
  /** 是否启用逐行模糊效果（默认 false） */
  enableBlur: boolean;
  /** 是否启用逐字高亮效果（默认 true） */
  enableWordHighlight: boolean;
  /** 是否启用逐字上浮动画（默认 true） */
  enableFloatAnimation: boolean;
  /** 是否启用强调效果：缩放 + 辉光 + 正弦浮动（默认 true） */
  enableEmphasizeEffect: boolean;
  /** 歌词行点击回调（传入该行起始时间，用于跳转播放进度） */
  onLineClick?: (timeMs: number) => void;
}
