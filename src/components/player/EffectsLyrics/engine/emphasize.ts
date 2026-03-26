/**
 * 逐字上浮与强调动画
 *
 * 基于 Web Animations API，为激活行的单词添加：
 * 1. 基础上浮（所有单词）：播放期间缓慢上移 0.05em
 * 2. 强调效果（长音节单词）：缩放 + 辉光 + 正弦浮动 + 逐字符延迟
 */

import type { LyricWord } from "@/types/lyric";

// ---- 常量 ----

const FRAME_COUNT = 32;
const EMP_MID = 0.5;

// ---- 缓动函数（简化的贝塞尔曲线替代） ----

/** 简单的 ease-in 曲线 */
const easeIn = (x: number): number => x * x * (3 - 2 * x);
/** 简单的 ease-out 曲线 */
const easeOut = (x: number): number => x * x * (3 - 2 * x);

const normalize = (min: number, max: number, x: number) =>
  Math.min(1, Math.max(0, (x - min) / (max - min)));

const empEasing = (x: number): number =>
  x < EMP_MID
    ? easeIn(normalize(0, EMP_MID, x))
    : 1 - easeOut(normalize(EMP_MID, 1, x));

// ---- CJK 检测 ----

const CJK_RE = /^[\p{Unified_Ideograph}\u0800-\u9FFC]+$/u;
const isCJK = (s: string): boolean => CJK_RE.test(s);

// ---- matrix3d 工具 ----

const scaleMatrix3dCSS = (s: number): string =>
  `matrix3d(${s},0,0,0,0,${s},0,0,0,0,${s},0,0,0,0,1)`;

// ---- 公共 API ----

/**
 * 判断单词是否应该启用强调效果
 * - CJK：持续时间 ≥ 1000ms
 * - 非 CJK：持续时间 ≥ 1000ms 且长度 2~7
 */
export const shouldEmphasize = (word: LyricWord): boolean => {
  const duration = word.endTime - word.startTime;
  if (duration < 1000) return false;
  if (isCJK(word.word)) return true;
  const len = word.word.trim().length;
  return len > 1 && len <= 7;
};

/**
 * 判断一组 chunk 是否应该启用强调效果
 */
export const shouldChunkEmphasize = (chunk: LyricWord[]): boolean => {
  if (chunk.some(shouldEmphasize)) return true;
  // 合并后再检查
  if (chunk.length > 1) {
    const merged: LyricWord = {
      word: chunk.map((w) => w.word).join(""),
      startTime: Math.min(...chunk.map((w) => w.startTime)),
      endTime: Math.max(...chunk.map((w) => w.endTime)),
    };
    if (!isCJK(merged.word)) return shouldEmphasize(merged);
  }
  return false;
};

/** 存储一行的所有动画 */
export interface LineAnimations {
  /** 所有 Web Animation 实例 */
  animations: Animation[];
}

/**
 * 为单个单词 span 创建基础上浮动画（所有单词通用）
 *
 * @param wordEl - 单词 span 元素
 * @param delay - 相对行起始的延迟（ms）
 * @param duration - 动画持续时间（ms）
 * @param isBG - 是否为背景行
 */
export const createFloatAnimation = (
  wordEl: HTMLElement,
  delay: number,
  duration: number,
  isBG: boolean,
): Animation => {
  let up = 0.05;
  if (isBG) up *= 2;
  const dur = Math.max(1000, duration);
  const del = Math.max(0, delay);

  const anim = wordEl.animate(
    [
      { transform: "translateY(0px)" },
      { transform: `translateY(${-up}em)` },
    ],
    {
      duration: Number.isFinite(dur) ? dur : 0,
      delay: Number.isFinite(del) ? del : 0,
      id: "float-word",
      composite: "add",
      fill: "both",
      easing: "ease-out",
    },
  );
  anim.pause();
  return anim;
};

/**
 * 为强调单词的每个字符创建 glow + 正弦浮动动画
 *
 * @param charElements - 字符级 span 元素数组
 * @param duration - 合并后单词的总持续时间（ms）
 * @param delay - 相对行起始的延迟（ms）
 * @param isLastWord - 是否为行末单词（增强效果）
 * @param isBG - 是否为背景行
 */
export const createEmphasizeAnimations = (
  charElements: HTMLElement[],
  duration: number,
  delay: number,
  isLastWord: boolean,
  isBG: boolean,
): Animation[] => {
  const de = Math.max(0, delay);
  let du = Math.max(1000, duration);
  const charCount = Math.max(1, charElements.length);
  const result: Animation[] = [];

  // 计算效果强度
  let amount = du / 2000;
  amount = amount > 1 ? Math.sqrt(amount) : amount ** 3;
  let blur = du / 3000;
  blur = blur > 1 ? Math.sqrt(blur) : blur ** 3;
  amount *= 0.6;
  blur *= 0.5;

  if (isLastWord) {
    amount *= 1.6;
    blur *= 1.5;
    du *= 1.2;
  }
  amount = Math.min(1.2, amount);
  blur = Math.min(0.8, blur);

  const animDu = Number.isFinite(du) ? du : 0;

  for (let i = 0; i < charElements.length; i++) {
    const el = charElements[i];
    const wordDe = de + (du / 2.5 / charCount) * i;

    // 1. Glow + Scale + Translate 动画
    const glowFrames: Keyframe[] = new Array(FRAME_COUNT)
      .fill(0)
      .map((_, j) => {
        const x = (j + 1) / FRAME_COUNT;
        const transX = empEasing(x);
        const glowLevel = empEasing(x) * blur;

        const scale = 1 + transX * 0.1 * amount;
        const offsetX = -transX * 0.03 * amount * (charElements.length / 2 - i);
        const offsetY = -transX * 0.025 * amount;

        return {
          offset: x,
          transform: `${scaleMatrix3dCSS(scale)} translate(${offsetX}em, ${offsetY}em)`,
          textShadow: `0 0 ${Math.min(0.3, blur * 0.3)}em rgba(255, 255, 255, ${glowLevel})`,
        };
      });

    const glow = el.animate(glowFrames, {
      duration: animDu,
      delay: Number.isFinite(wordDe) ? wordDe : 0,
      id: `emphasize-glow-${i}`,
      iterations: 1,
      composite: "replace",
      fill: "both",
    });
    glow.onfinish = () => glow.pause();
    glow.pause();
    result.push(glow);

    // 2. 正弦浮动动画
    const floatFrames: Keyframe[] = new Array(FRAME_COUNT)
      .fill(0)
      .map((_, j) => {
        const x = (j + 1) / FRAME_COUNT;
        let y = Math.sin(x * Math.PI);
        if (isBG) y *= 2;
        return {
          offset: x,
          transform: `translateY(${-y * 0.05}em)`,
        };
      });

    const float = el.animate(floatFrames, {
      duration: animDu * 1.4,
      delay: Number.isFinite(wordDe) ? wordDe - 400 : 0,
      id: "emphasize-float",
      iterations: 1,
      composite: "add",
      fill: "both",
    });
    float.onfinish = () => float.pause();
    float.pause();
    result.push(float);
  }

  return result;
};

