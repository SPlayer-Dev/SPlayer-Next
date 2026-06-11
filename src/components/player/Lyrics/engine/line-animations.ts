/**
 * 歌词渲染引擎 — 行级 Web Animations 生命周期管理
 *
 * 行激活时懒创建动画，停用时反向回落并在全部完成后自动清理，
 * 避免长歌词累积大量持有 fill 状态的合成层动画
 */

import type { LyricLine } from "@shared/types/lyrics";
import type { WordAnimTarget } from "./word-builder";
import { createFloatAnimation, createEmphasizeAnimations } from "./emphasize";

/** 行激活时的动画创建选项 */
export interface ActivateOptions {
  /** 是否正在播放 */
  playing: boolean;
  /** 是否启用逐字上浮动画 */
  float: boolean;
  /** 是否启用强调效果 */
  emphasize: boolean;
}

/**
 * 计算动画的有效结束时间（delay + duration，毫秒）
 * @param anim - 动画实例
 * @returns 结束时间
 */
const animEndTime = (anim: Animation): number => {
  const timing = anim.effect?.getComputedTiming();
  return ((timing?.delay as number) || 0) + ((timing?.duration as number) || 0);
};

/**
 * 将动画对齐到相对行起始的时间；未播完则从该处恢复播放
 * @param anim - 动画实例
 * @param relativeTime - 相对行起始的时间（毫秒）
 */
const realignAndPlay = (anim: Animation, relativeTime: number) => {
  if (anim.playbackRate >= 0 && relativeTime < animEndTime(anim)) {
    anim.currentTime = relativeTime;
    anim.play();
  }
};

export class LineAnimationController {
  /** 当前持有动画的行（行索引 → Animation[]），停用时保留，重新激活时替换 */
  private animations = new Map<number, Animation[]>();

  /**
   * @param isLineActive - 查询某行当前是否处于激活态（延迟清理判定用）
   */
  constructor(private isLineActive: (lineIndex: number) => boolean) {}

  /**
   * 行激活：按需创建动画并对齐到当前播放时间
   * @param lineIndex - 行索引
   * @param line - 歌词行数据
   * @param targets - 该行的动画目标描述
   * @param currentTime - 当前播放时间（毫秒）
   * @param options - 播放状态与效果开关
   */
  activate = (
    lineIndex: number,
    line: LyricLine,
    targets: WordAnimTarget[] | undefined,
    currentTime: number,
    options: ActivateOptions,
  ) => {
    // 清理该行旧动画（上一次停用时保留的）
    const oldAnims = this.animations.get(lineIndex);
    if (oldAnims)
      for (const anim of oldAnims) {
        anim.onfinish = null;
        anim.cancel();
      }

    if (!targets?.length || (!options.float && !options.emphasize)) return;

    const relativeTime = Math.max(0, currentTime - line.startTime);
    const anims: Animation[] = [];

    for (const target of targets) {
      // 基础上浮动画
      if (options.float) {
        anims.push(
          createFloatAnimation(
            target.element,
            target.word.startTime - line.startTime,
            target.word.endTime - target.word.startTime,
            line.isBG,
          ),
        );
      }
      // 强调动画（缩放 + 辉光 + 正弦浮动）
      if (options.emphasize && target.isEmphasize && target.charElements.length > 0) {
        anims.push(
          ...createEmphasizeAnimations(
            target.charElements,
            target.word.endTime - target.word.startTime,
            target.word.startTime - line.startTime,
            target.isLastWord,
            line.isBG,
          ),
        );
      }
    }

    // 设置 currentTime 并根据播放状态决定 play/pause
    for (const anim of anims) {
      anim.currentTime = relativeTime;
      anim.playbackRate = 1;
      if (options.playing && relativeTime < animEndTime(anim)) anim.play();
      else anim.pause();
    }

    this.animations.set(lineIndex, anims);
  };

  /**
   * 行停用：
   * - float 反向播放实现平滑回落
   * - glow/scale 保持当前状态，随行透明度自然淡出
   * - 动画完成后自动清理，避免累积
   * @param lineIndex - 行索引
   */
  deactivate = (lineIndex: number) => {
    const anims = this.animations.get(lineIndex);
    if (!anims) return;

    // 统计未完成的动画数量，全部完成后自动清理
    let pendingCount = anims.length;
    const tryCleanup = () => {
      if (--pendingCount > 0) return;
      // 所有动画均已完成，若该行仍非激活则清理
      if (!this.isLineActive(lineIndex)) {
        const currentAnims = this.animations.get(lineIndex);
        if (currentAnims === anims) {
          for (const anim of anims) anim.cancel();
          this.animations.delete(lineIndex);
        }
      }
    };

    for (const anim of anims) {
      // 基础 float 反向播放回落，glow/emphasize-float 缓动曲线 0→峰→0 会自然回零
      if (anim.id === "float-word") {
        anim.playbackRate = -1;
        anim.play();
      }
      // 所有动画完成后触发清理
      anim.onfinish = tryCleanup;
    }
    // 已结束或暂停的动画不会再触发 onfinish，主动计入，避免该行动画永不被清理
    for (const anim of anims) {
      if (anim.playState === "finished" || anim.playState === "paused") tryCleanup();
    }
  };

  /**
   * 将所有激活行的动画对齐到当前播放时间后恢复播放（暂停恢复 / 冻结恢复共用）
   * @param lines - 歌词行数组
   * @param currentTime - 当前播放时间（毫秒）
   */
  realignActive = (lines: LyricLine[], currentTime: number) => {
    for (const [lineIdx, anims] of this.animations) {
      if (!this.isLineActive(lineIdx)) continue;
      const line = lines[lineIdx];
      if (!line) continue;
      const relativeTime = Math.max(0, currentTime - line.startTime);
      for (const anim of anims) realignAndPlay(anim, relativeTime);
    }
  };

  /** 暂停所有激活行的动画（播放暂停时） */
  pauseActive = () => {
    for (const [lineIdx, anims] of this.animations) {
      if (!this.isLineActive(lineIdx)) continue;
      for (const anim of anims) anim.pause();
    }
  };

  /** 暂停全部动画（冻结渲染时；Web Animations 不随 rAF 暂停而停止） */
  pauseAll = () => {
    for (const anims of this.animations.values()) {
      for (const anim of anims) anim.pause();
    }
  };

  /** 取消所有非激活行的残留动画，释放合成资源 */
  cleanupInactive = () => {
    for (const [lineIdx, anims] of this.animations) {
      if (this.isLineActive(lineIdx)) continue;
      for (const anim of anims) anim.cancel();
      this.animations.delete(lineIdx);
    }
  };

  /** 取消所有行的动画并清空映射 */
  cancelAll = () => {
    for (const anims of this.animations.values()) for (const anim of anims) anim.cancel();
    this.animations.clear();
  };
}
