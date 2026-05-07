/**
 * LyricRenderer — 高性能歌词渲染引擎
 *
 * - 零框架依赖，纯 TypeScript + 直接 DOM 操作
 * - 单 rAF 循环驱动弹簧、透明度、间奏等所有动画
 * - CSS 变量 --t 驱动逐字掩码，每帧仅写 1 个变量到激活行
 * - 视口裁剪：屏幕外元素跳过 DOM 写入
 * - 懒创建动画：仅激活行持有 Animation 对象
 */

import { Spring, type SpringParams } from "./spring";
import type { LyricLine } from "@shared/types/lyrics";
import { setMin } from "../utils/math";
import { DEFAULTS } from "./constants";
import {
  buildWordSpans,
  measureAndApplyWordMasks,
  type WordMeasurement,
  type WordAnimTarget,
} from "./word-builder";
import {
  createInterludeDots,
  detectInterlude,
  renderInterludeDots,
  type InterludeState,
  type InterludeCache,
} from "./interlude";
import { createFloatAnimation, createEmphasizeAnimations } from "./emphasize";

export type { RendererConfig } from "./constants";
import type { RendererConfig } from "./constants";

export class LyricRenderer {
  /** 外层容器 */
  private container: HTMLElement;
  /** 内部包裹层，承载所有歌词行和间奏圆点 */
  private innerElement: HTMLDivElement;
  /** 间奏呼吸圆点容器 */
  private dotsContainer!: HTMLDivElement;
  /** 三个间奏圆点元素 */
  private dotElements!: [HTMLSpanElement, HTMLSpanElement, HTMLSpanElement];

  /** 歌词行数据 */
  private lines: LyricLine[] = [];
  /** 每行对应的 DOM 元素 */
  private lineElements: HTMLDivElement[] = [];
  /** 每行的单词测量数据（用于 CSS mask 计算） */
  private wordMeasurements: WordMeasurement[][] = [];
  /** 每行的动画目标描述（懒创建动画的依据） */
  private lineAnimTargets: WordAnimTarget[][] = [];
  /** 当前持有动画的行（行索引 → Animation[]），停用时保留，重新激活时替换 */
  private activeAnimations = new Map<number, Animation[]>();
  /** 标记是否为静态行（≤1 个单词，无逐字动画） */
  private isStaticLine: boolean[] = [];

  /** 当前主激活行索引（多行激活时取最小） */
  private activeLineIndex = -1;
  /** 所有激活行索引集合 */
  private activeLineSet = new Set<number>();
  /** 上一次处理的播放时间，用于 seek 检测 */
  private lastProcessedTime = -1;

  /** 每行的 Y 轴位置弹簧 */
  private positionSprings: Spring[] = [];
  /** 每行的缩放弹簧（值域 0~100，对应 0~1 的 scale） */
  private scaleSprings: Spring[] = [];

  /** 每行的高度缓存（offsetHeight） */
  private lineHeights: Float64Array = new Float64Array(0);
  /** 容器宽度 */
  private containerWidth = 0;
  /** 容器高度 */
  private containerHeight = 0;

  /** 每行的透明度值（当前插值），驱动 --ba / --da CSS 变量 */
  private alphaValues: Float64Array = new Float64Array(0);
  /** 每行的模糊值（当前插值），驱动 --blur CSS 变量 */
  private blurValues: Float64Array = new Float64Array(0);
  /** 已播放行淡出值，驱动 --pass CSS 变量（用于副歌词透明度） */
  private passValues: Float64Array = new Float64Array(0);
  /** --pass 写入缓存，避免重复 DOM 写入 */
  private cachedPassKeys: string[] = [];

  /** 入场动画是否已全部完成（完成后跳过计算） */
  private entranceComplete = true;

  /** 用户手动滚动的偏移量（px） */
  private userScrollOffset = 0;
  /** 是否处于用户滚动状态 */
  private isUserScrolling = false;
  /** 鼠标是否悬停在容器上（悬停时抑制模糊） */
  private isHovering = false;
  /** 滚动回弹定时器 ID */
  private scrollResetTimerId = 0;
  /** 上一次触摸 Y 坐标 */
  private lastTouchY = 0;

  /** 间奏状态 */
  private interludeState: InterludeState = {
    isActive: false,
    startTime: 0,
    endTime: 0,
    x: 0,
    y: 0,
    alignRight: false,
  };
  /** 间奏渲染缓存 */
  private interludeCache: InterludeCache = {
    containerStyle: "",
    dotOpacities: ["", "", ""],
  };
  /** 间奏圆点容器宽度 */
  private dotsContainerWidth = 0;
  /** 间奏圆点容器高度 */
  private dotsContainerHeight = 0;

  /** rAF 句柄，0 表示未运行 */
  private animationFrameId = 0;
  /** 上一帧的时间戳，用于计算 deltaTime */
  private lastFrameTimestamp = 0;
  /** 页面是否可见（不可见时跳过渲染） */
  private isPageVisible = true;
  /** 是否需要强制全量同步（跳过视口裁剪） */
  private needsFullSync = false;
  /** 外部推送的待消费播放时间 */
  private pendingPlayTime = -1;

  /** transform 缓存 */
  private cachedTransforms: string[] = [];
  /** 透明度缓存 */
  private cachedAlphaKeys: string[] = [];
  /** 模糊缓存 */
  private cachedBlurKeys: string[] = [];
  /** --t 时间缓存 */
  private cachedTimeString = "";

  /** 激活行在容器中的对齐位置（0~1） */
  private alignPosition = DEFAULTS.alignPosition;
  /** 是否正在播放 */
  private isPlaying = true;
  /** 逐字掩码渐变宽度比例 */
  private wordFadeWidth = DEFAULTS.wordFadeWidth;
  /** 弹簧物理参数 */
  private springParams: Partial<SpringParams> = {};
  /** 歌词行点击回调 */
  private lineClickCallback: ((timeMs: number) => void) | null = null;
  /** 用户滚动后回弹延迟（ms） */
  private scrollResetDelay = DEFAULTS.scrollResetDelay;
  /** 触发间奏动画的最小间隔（ms） */
  private minInterludeGap = DEFAULTS.minInterludeGap;
  /** 间奏圆点呼吸周期（ms） */
  private breatheCycleTarget = DEFAULTS.breatheCycleTarget;
  /** 透明度激活速度 */
  private alphaAttackSpeed = DEFAULTS.alphaAttackSpeed;
  /** 透明度释放速度 */
  private alphaReleaseSpeed = DEFAULTS.alphaReleaseSpeed;
  /** 非激活行基础透明度 */
  private inactiveAlpha = DEFAULTS.inactiveAlpha;
  /** 是否隐藏已播放行 */
  private hidePassedLines = DEFAULTS.hidePassedLines;
  /** 是否启用逐行模糊 */
  private enableBlur = DEFAULTS.enableBlur;
  /** 是否启用逐字高亮 */
  private enableWordHighlight = DEFAULTS.enableWordHighlight;
  /** 是否启用逐字上浮动画 */
  private enableFloatAnimation = DEFAULTS.enableFloatAnimation;
  /** 是否启用强调效果（缩放 + 辉光） */
  private enableEmphasizeEffect = DEFAULTS.enableEmphasizeEffect;
  /** 是否显示翻译歌词 */
  private showTranslation = DEFAULTS.showTranslation;
  /** 是否显示音译歌词 */
  private showRomanization = DEFAULTS.showRomanization;

  /** 容器尺寸变化观察器 */
  private containerResizeObserver: ResizeObserver;
  /** 哨兵行尺寸观察器（检测字体/样式变化） */
  private sentinelResizeObserver: ResizeObserver;
  /** 哨兵行元素 */
  private sentinelElement: HTMLDivElement | null = null;

  /**
   * @param container - 外层容器元素
   * @param config - 可选的初始配置
   */
  constructor(container: HTMLElement, config?: Partial<RendererConfig>) {
    this.container = container;
    // 移除上一次实例残留的 lp-inner
    for (const stale of Array.from(container.querySelectorAll(":scope > .lp-inner"))) {
      stale.remove();
    }
    container.classList.add("lp-root");
    // 创建内部包裹层
    this.innerElement = document.createElement("div");
    this.innerElement.className = "lp-inner";
    container.appendChild(this.innerElement);
    // 创建间奏圆点
    [this.dotsContainer, this.dotElements] = createInterludeDots(this.innerElement);
    if (config) this.applyConfig(config);
    // 缓存容器尺寸
    this.containerWidth = container.clientWidth;
    this.containerHeight = container.clientHeight;
    // 尺寸观察器
    this.containerResizeObserver = new ResizeObserver(this.handleContainerResize);
    this.containerResizeObserver.observe(container);
    this.sentinelResizeObserver = new ResizeObserver(this.handleSentinelResize);
    // 事件监听
    container.addEventListener("wheel", this.handleWheel, { passive: false });
    container.addEventListener("touchstart", this.handleTouchStart, {
      passive: true,
    });
    container.addEventListener("touchmove", this.handleTouchMove, {
      passive: false,
    });
    container.addEventListener("touchend", this.handleTouchEnd, {
      passive: true,
    });
    container.addEventListener("click", this.handleLineClick);
    container.addEventListener("mouseenter", this.handleMouseEnter);
    container.addEventListener("mouseleave", this.handleMouseLeave);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    // 启动渲染循环
    this.animationFrameId = requestAnimationFrame(this.onAnimationFrame);
  }

  /** 冻结渲染 */
  freeze = () => {
    cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = 0;
    // Web Animations 走自己的时间线，不随 rAF 暂停而停止；冻结期间也要 pause
    for (const anims of this.activeAnimations.values()) {
      for (const anim of anims) anim.pause();
    }
  };

  /** 恢复渲染 */
  resume = () => {
    if (this.animationFrameId !== 0) return;
    this.lastFrameTimestamp = 0;
    this.needsFullSync = true;
    // 恢复时按当前播放时间重新对齐动画 currentTime 后再 play
    if (this.isPlaying) {
      for (const [lineIdx, anims] of this.activeAnimations) {
        const line = this.lines[lineIdx];
        if (!line) continue;
        const relativeTime = Math.max(0, this.lastProcessedTime - line.startTime);
        for (const anim of anims) {
          const timing = anim.effect?.getComputedTiming();
          const endTime = ((timing?.delay as number) || 0) + ((timing?.duration as number) || 0);
          if (anim.playbackRate >= 0 && relativeTime < endTime) {
            anim.currentTime = relativeTime;
            anim.play();
          }
        }
      }
    }
    this.animationFrameId = requestAnimationFrame(this.onAnimationFrame);
  };

  /** 销毁渲染器 */
  dispose = () => {
    cancelAnimationFrame(this.animationFrameId);
    clearTimeout(this.scrollResetTimerId);
    this.cancelAllActiveAnimations();
    this.containerResizeObserver.disconnect();
    this.sentinelResizeObserver.disconnect();
    this.container.removeEventListener("wheel", this.handleWheel);
    this.container.removeEventListener("touchstart", this.handleTouchStart);
    this.container.removeEventListener("touchmove", this.handleTouchMove);
    this.container.removeEventListener("touchend", this.handleTouchEnd);
    this.container.removeEventListener("click", this.handleLineClick);
    this.container.removeEventListener("mouseenter", this.handleMouseEnter);
    this.container.removeEventListener("mouseleave", this.handleMouseLeave);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.innerElement.remove();
    this.container.classList.remove("lp-root");
  };

  /**
   * 设置歌词数据
   * @param lines - 歌词行数组
   */
  setLyrics = (lines: LyricLine[]) => {
    this.cancelAllActiveAnimations();
    for (const element of this.lineElements) element.remove();

    // 重置状态
    this.lines = lines;
    this.activeLineIndex = -1;
    this.activeLineSet.clear();
    this.lastProcessedTime = -1;
    this.userScrollOffset = 0;
    this.interludeState.isActive = false;

    const lineCount = lines.length;

    // 初始化弹簧（位置弹簧初始在屏幕外，缩放弹簧初始 97%）
    const offScreen = Math.max(this.containerHeight * 2, 2000);
    this.positionSprings = new Array(lineCount);
    this.scaleSprings = new Array(lineCount);
    for (let i = 0; i < lineCount; i++) {
      this.positionSprings[i] = new Spring(offScreen);
      const scaleSpring = new Spring(97);
      scaleSpring.updateParams(
        lines[i].isBG
          ? { mass: 1, damping: 20, stiffness: 50 }
          : { mass: 2, damping: 25, stiffness: 100 },
      );
      this.scaleSprings[i] = scaleSpring;
    }
    this.applySpringParams();

    // 初始化透明度为非激活值
    this.alphaValues = new Float64Array(lineCount * 2);
    for (let i = 0; i < lineCount; i++) {
      this.alphaValues[i * 2] = this.inactiveAlpha;
      this.alphaValues[i * 2 + 1] = this.inactiveAlpha;
    }

    // 初始化缓存数组
    this.lineHeights = new Float64Array(lineCount);
    this.cachedTransforms = new Array(lineCount).fill("");
    this.cachedAlphaKeys = new Array(lineCount).fill("");
    this.cachedBlurKeys = new Array(lineCount).fill("");
    this.blurValues = new Float64Array(lineCount);
    this.passValues = new Float64Array(lineCount).fill(1);
    this.cachedPassKeys = new Array(lineCount).fill("");

    this.entranceComplete = false;

    // 构建 DOM
    this.lineElements = new Array(lineCount);
    this.wordMeasurements = new Array(lineCount);
    this.lineAnimTargets = new Array(lineCount);
    this.isStaticLine = new Array(lineCount);

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < lineCount; i++) {
      const line = lines[i];
      const lineEl = document.createElement("div");
      lineEl.className = "lp-line" + (line.isDuet ? " duet" : "") + (line.isBG ? " bg" : "");
      const mainDiv = document.createElement("div");
      mainDiv.className = "lp-main";

      // 静态行（≤1 个单词）不需要逐字动画
      const isStatic = line.words.length <= 1;
      this.isStaticLine[i] = isStatic;

      if (isStatic) {
        mainDiv.appendChild(document.createTextNode(line.words.map((w) => w.word).join("")));
        // 给静态行也加统一 mask，让 --ba 对其生效，与逐字行透明度一致
        mainDiv.style.setProperty(
          "-webkit-mask-image",
          "linear-gradient(rgba(0,0,0,var(--ba)),rgba(0,0,0,var(--ba)))",
        );
        mainDiv.style.setProperty(
          "mask-image",
          "linear-gradient(rgba(0,0,0,var(--ba)),rgba(0,0,0,var(--ba)))",
        );
        this.wordMeasurements[i] = [];
        this.lineAnimTargets[i] = [];
      } else {
        // 构建单词 span + 动画目标描述
        const result = buildWordSpans(line.words, mainDiv, this.enableEmphasizeEffect);
        this.wordMeasurements[i] = result.measurements;
        this.lineAnimTargets[i] = result.animTargets;
      }

      // 内容包裹层
      const contentDiv = document.createElement("div");
      contentDiv.className = "lp-content";
      contentDiv.appendChild(mainDiv);

      if (this.showTranslation && line.translatedLyric) {
        const subDiv = document.createElement("div");
        subDiv.className = "lp-sub";
        subDiv.textContent = line.translatedLyric;
        contentDiv.appendChild(subDiv);
      }
      if (this.showRomanization && line.romanLyric) {
        const subDiv = document.createElement("div");
        subDiv.className = "lp-sub";
        subDiv.textContent = line.romanLyric;
        contentDiv.appendChild(subDiv);
      }

      lineEl.appendChild(contentDiv);
      this.lineElements[i] = lineEl;
      fragment.appendChild(lineEl);
    }

    this.innerElement.appendChild(fragment);

    // 哨兵观察器：监听第一行尺寸变化以检测字体/样式变化
    this.sentinelResizeObserver.disconnect();
    this.sentinelElement = null;
    if (lineCount > 0) {
      this.sentinelElement = this.lineElements[0];
      this.sentinelResizeObserver.observe(this.sentinelElement);
    }

    // 测量尺寸 + 计算 CSS mask
    this.dotsContainerWidth = this.dotsContainer.offsetWidth || 60;
    this.dotsContainerHeight = this.dotsContainer.offsetHeight || 20;
    this.measureLineHeights();
    measureAndApplyWordMasks(this.wordMeasurements, this.wordFadeWidth, this.lines);

    // 重置时间状态，避免残留旧歌的播放时间影响新歌词定位
    this.pendingPlayTime = -1;
    this.lastProcessedTime = -1;
    // 重置帧时间戳，避免渲染器空闲后首帧 deltaTime 过大导致弹簧瞬移
    this.lastFrameTimestamp = 0;

    // 初始布局 + 入场动画（从 time=0 开始）
    this.handleSeek(0);
    this.calculateLayout(true);
    this.playEntranceAnimation(this.containerHeight * 0.6);
    this.needsFullSync = true;
  };

  /**
   * 推送当前播放时间
   * @param timeMs - 当前播放时间
   */
  setCurrentTime = (timeMs: number) => {
    this.pendingPlayTime = timeMs;
  };

  /**
   * 设置播放/暂停状态
   * @param playing - 是否正在播放
   */
  setPlaying = (playing: boolean) => {
    if (this.isPlaying === playing) return;
    this.isPlaying = playing;

    // 暂停/恢复所有激活行的动画
    for (const lineIdx of this.activeLineSet) {
      const anims = this.activeAnimations.get(lineIdx);
      if (!anims?.length) continue;
      if (playing) {
        const relativeTime = Math.max(0, this.lastProcessedTime - this.lines[lineIdx].startTime);
        for (const anim of anims) {
          const timing = anim.effect?.getComputedTiming();
          const endTime = ((timing?.delay as number) || 0) + ((timing?.duration as number) || 0);
          if (anim.playbackRate >= 0 && relativeTime < endTime) {
            anim.currentTime = relativeTime;
            anim.play();
          }
        }
      } else {
        for (const anim of anims) anim.pause();
      }
    }

    this.calculateLayout(false);
    this.needsFullSync = true;
  };

  /**
   * 更新渲染器配置
   * @param config - 部分配置项
   */
  setConfig = (config: Partial<RendererConfig>) => {
    this.applyConfig(config);
  };

  /**
   * 应用配置
   * @param config - 部分配置项
   */
  private applyConfig = (config: Partial<RendererConfig>) => {
    let layoutDirty = false;
    if (config.alignPosition != null && config.alignPosition !== this.alignPosition) {
      this.alignPosition = config.alignPosition;
      layoutDirty = true;
    }
    if (config.playing != null && config.playing !== this.isPlaying) {
      this.isPlaying = config.playing;
      layoutDirty = true;
    }
    if (config.wordFadeWidth != null && config.wordFadeWidth !== this.wordFadeWidth) {
      this.wordFadeWidth = config.wordFadeWidth;
      if (this.lineElements.length > 0)
        measureAndApplyWordMasks(this.wordMeasurements, this.wordFadeWidth, this.lines);
    }
    if (config.onLineClick !== undefined) this.lineClickCallback = config.onLineClick ?? null;
    if (config.springConfig) {
      this.springParams = config.springConfig;
      this.applySpringParams();
    }
    if (config.scrollResetDelay != null) this.scrollResetDelay = config.scrollResetDelay;
    if (config.minInterludeGap != null) this.minInterludeGap = config.minInterludeGap;
    if (config.breatheCycleTarget != null) this.breatheCycleTarget = config.breatheCycleTarget;
    if (config.alphaAttackSpeed != null) this.alphaAttackSpeed = config.alphaAttackSpeed;
    if (config.alphaReleaseSpeed != null) this.alphaReleaseSpeed = config.alphaReleaseSpeed;
    if (config.inactiveAlpha != null) this.inactiveAlpha = config.inactiveAlpha;
    if (config.hidePassedLines != null) this.hidePassedLines = config.hidePassedLines;
    if (config.enableBlur != null) this.enableBlur = config.enableBlur;
    if (config.enableWordHighlight != null) this.enableWordHighlight = config.enableWordHighlight;
    if (config.enableFloatAnimation != null)
      this.enableFloatAnimation = config.enableFloatAnimation;
    if (config.enableEmphasizeEffect != null)
      this.enableEmphasizeEffect = config.enableEmphasizeEffect;
    if (config.showTranslation != null) this.showTranslation = config.showTranslation;
    if (config.showRomanization != null) this.showRomanization = config.showRomanization;

    if (layoutDirty && this.lineElements.length > 0) {
      this.measureLineHeights();
      this.calculateLayout(false);
      this.needsFullSync = true;
    }
  };

  /** 测量所有行的 offsetHeight 并缓存到 lineHeights */
  private measureLineHeights = () => {
    for (let i = 0; i < this.lineElements.length; i++) {
      this.lineHeights[i] = this.lineElements[i]?.offsetHeight || 40;
    }
  };

  /**
   * 处理播放时间变化，检测激活行的增减
   * 自动识别 seek：时间倒退 >100ms 或前进 >2000ms
   * @param currentTime - 当前播放时间（毫秒）
   * @returns 是否发生了激活行变化
   */
  private processTime = (currentTime: number): boolean => {
    const isFirst = this.lastProcessedTime < 0;
    const isSeeked =
      !isFirst &&
      (currentTime < this.lastProcessedTime - 100 || currentTime > this.lastProcessedTime + 2000);
    this.lastProcessedTime = currentTime;

    if (isFirst || isSeeked) {
      this.handleSeek(currentTime);
      return true;
    }

    const lines = this.lines;
    const activated: number[] = [];
    const deactivated = new Set<number>();

    // 检测新激活的行
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.isBG) continue;
      if (
        line.startTime <= currentTime &&
        line.endTime > currentTime &&
        !this.activeLineSet.has(i)
      ) {
        activated.push(i);
        if (lines[i + 1]?.isBG) activated.push(i + 1);
      }
    }

    // 检测需要停用的行
    for (const lineIdx of this.activeLineSet) {
      const line = lines[lineIdx];
      if (!line) {
        deactivated.add(lineIdx);
        continue;
      }
      if (line.isBG) {
        if (!this.activeLineSet.has(lineIdx - 1) || deactivated.has(lineIdx - 1))
          deactivated.add(lineIdx);
        continue;
      }
      const nextLine = lines[lineIdx + 1];
      if (nextLine?.isBG) {
        // 对唱行：计算配对的时间范围
        const nextMainLine = lines[lineIdx + 2];
        const pairStart = Math.min(line.startTime, nextLine.startTime);
        const pairEnd = Math.min(
          Math.max(line.endTime, nextMainLine?.startTime ?? Number.MAX_VALUE),
          Math.max(line.endTime, nextLine.endTime),
        );
        if (pairStart > currentTime || pairEnd <= currentTime) deactivated.add(lineIdx);
      } else {
        if (line.startTime > currentTime || line.endTime <= currentTime) deactivated.add(lineIdx);
      }
    }

    if (activated.length === 0 && deactivated.size === 0) return false;

    // 执行停用/激活
    for (const lineIdx of deactivated) {
      this.activeLineSet.delete(lineIdx);
      this.lineElements[lineIdx]?.classList.remove("active");
      this.deactivateLineAnimations(lineIdx);
    }
    for (const lineIdx of activated) {
      this.activeLineSet.add(lineIdx);
      this.lineElements[lineIdx]?.classList.add("active");
      this.createAndPlayLineAnimations(lineIdx, currentTime);
    }

    if (this.activeLineSet.size > 0) this.activeLineIndex = setMin(this.activeLineSet);

    this.measureLineHeights();
    this.calculateLayout(false);
    return true;
  };

  /**
   * 处理 seek
   * @param targetTime - 跳转目标时间（毫秒）
   */
  private handleSeek = (targetTime: number) => {
    this.userScrollOffset = 0;
    this.isUserScrolling = false;
    clearTimeout(this.scrollResetTimerId);

    // 停用所有当前激活行
    for (const lineIdx of this.activeLineSet) {
      this.lineElements[lineIdx]?.classList.remove("active");
      this.deactivateLineAnimations(lineIdx);
    }
    this.activeLineSet.clear();

    // 扫描并激活目标时间对应的行
    const lines = this.lines;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].isBG) continue;
      if (lines[i].startTime <= targetTime && lines[i].endTime > targetTime) {
        this.activeLineSet.add(i);
        this.lineElements[i]?.classList.add("active");
        this.createAndPlayLineAnimations(i, targetTime);
        if (lines[i + 1]?.isBG) {
          this.activeLineSet.add(i + 1);
          this.lineElements[i + 1]?.classList.add("active");
          this.createAndPlayLineAnimations(i + 1, targetTime);
        }
      }
    }

    if (this.activeLineSet.size > 0) {
      this.activeLineIndex = setMin(this.activeLineSet);
    } else {
      // 无激活行时，定位到下一个未来行
      const futureIdx = lines.findIndex((line) => line.startTime >= targetTime);
      this.activeLineIndex = futureIdx === -1 ? lines.length : futureIdx;
    }

    this.measureLineHeights();
    this.calculateLayout(false, true);
  };

  /**
   * 计算所有行的目标位置和缩放
   * @param syncImmediate - true 瞬移到目标位置，false 弹簧动画过渡
   * @param noCascade - true 跳过级联延迟，所有行同步运动（用于 seek）
   */
  private calculateLayout = (syncImmediate: boolean, noCascade = false) => {
    const viewHeight = this.containerHeight;
    const viewWidth = this.containerWidth;
    const currentTime = this.lastProcessedTime;
    const targetIdx = this.activeLineIndex;
    const lines = this.lines;
    const lineCount = this.positionSprings.length;
    if (lineCount === 0) return;

    // 间奏检测
    const interlude = detectInterlude(currentTime, targetIdx, lines, this.minInterludeGap);
    const dotsGap = 10;
    if (interlude) {
      this.interludeState.startTime = interlude[0];
      this.interludeState.endTime = interlude[1];
      this.interludeState.isActive = true;
    } else {
      this.interludeState.isActive = false;
    }

    // 计算激活行之前的累计高度，确定起始位置
    let position = -this.userScrollOffset;
    let heightAccum = 0;
    for (let i = 0; i < targetIdx; i++) {
      if (lines[i]?.isBG && this.isPlaying && !this.activeLineSet.has(i)) continue;
      heightAccum += this.lineHeights[i] || 40;
    }
    position -= heightAccum;
    position += viewHeight * this.alignPosition - (this.lineHeights[targetIdx] || 40) / 2;

    // 级联延迟：越远离激活行的行延迟越小，产生波浪效果
    let cascadeDelay = 0;
    let baseDelay = syncImmediate || noCascade ? 0 : 50;
    let dotsInserted = false;

    for (let i = 0; i < lineCount; i++) {
      const posSpring = this.positionSprings[i];
      const scaleSpring = this.scaleSprings[i];
      const line = lines[i];
      if (!line) continue;

      // 间奏圆点占位
      if (!dotsInserted && interlude && i === interlude[2] + 1) {
        dotsInserted = true;
        position += dotsGap;
        const isDuet = interlude[3];
        this.interludeState.x = isDuet ? viewWidth - this.dotsContainerWidth : 0;
        this.interludeState.y = position;
        this.interludeState.alignRight = isDuet;
        position += this.dotsContainerHeight + dotsGap;
      }

      const isActive = this.activeLineSet.has(i);
      const targetScale = !isActive && this.isPlaying ? (line.isBG ? 75 : 97) : 100;

      const collapsedBG = line.isBG && this.isPlaying && !isActive;

      if (syncImmediate) {
        posSpring.setPosition(position);
        scaleSpring.setPosition(targetScale);
      } else {
        posSpring.setTargetPosition(position, cascadeDelay);
        scaleSpring.setTargetPosition(targetScale, cascadeDelay);
      }

      // 非激活 BG 行不占位
      if (!collapsedBG) position += this.lineHeights[i] || 40;

      if (position >= 0 && !this.isUserScrolling) {
        if (!line.isBG) cascadeDelay += baseDelay;
        if (i >= targetIdx) baseDelay /= 1.05;
      }
    }
  };

  /**
   * 入场动画：从底部升起 + 缩放恢复
   * @param offset - 初始偏移距离（px）
   */
  private playEntranceAnimation = (offset: number) => {
    for (let i = 0; i < this.positionSprings.length; i++) {
      const posSpring = this.positionSprings[i];
      const scaleSpring = this.scaleSprings[i];
      const targetY = posSpring.getCurrentPosition();
      const targetScale = scaleSpring.getCurrentPosition();
      posSpring.setPosition(targetY + offset);
      posSpring.setTargetPosition(targetY, i * 40);
      scaleSpring.setPosition(targetScale * 0.9);
      scaleSpring.setTargetPosition(targetScale, i * 40);
    }
  };

  /**
   * rAF 回调
   * @param timestamp - 当前时间戳
   */
  private onAnimationFrame = (timestamp: number) => {
    this.animationFrameId = requestAnimationFrame(this.onAnimationFrame);
    if (!this.isPageVisible) return;

    // 计算帧间隔，并夹紧上限避免 tab 后台 / 长时间冻结后的首帧 deltaTime 过大
    const rawDelta = this.lastFrameTimestamp ? timestamp - this.lastFrameTimestamp : 16;
    const deltaTime = rawDelta > 100 ? 100 : rawDelta;
    this.lastFrameTimestamp = timestamp;

    const lineCount = this.positionSprings.length;
    if (lineCount === 0) return;

    // 消费播放时间，检测激活行变化
    const playTime = this.pendingPlayTime;
    if (playTime >= 0 && playTime !== this.lastProcessedTime) {
      if (this.processTime(playTime)) this.needsFullSync = true;
    }

    // 更新激活行的 --t CSS 变量（驱动逐字掩码位移）
    if (this.enableWordHighlight && playTime >= 0) {
      const timeStr = String(playTime);
      if (timeStr !== this.cachedTimeString) {
        this.cachedTimeString = timeStr;
        for (const lineIdx of this.activeLineSet) {
          this.lineElements[lineIdx]?.style.setProperty("--t", timeStr);
        }
      }
    }

    // 推进弹簧 + 写入 transform
    const viewHeight = this.containerHeight;
    const isFullSync = this.needsFullSync;
    this.needsFullSync = false;

    for (let i = 0; i < lineCount; i++) {
      const posSpring = this.positionSprings[i];
      const scaleSpring = this.scaleSprings[i];
      posSpring.update(deltaTime);
      scaleSpring.update(deltaTime);

      const yPos = posSpring.getCurrentPosition();
      // 视口裁剪：屏幕外行跳过 transform 写入
      if (!isFullSync && (yPos < -500 || yPos > viewHeight + 500)) continue;
      const scale = scaleSpring.getCurrentPosition() / 100;
      const transformStr = `translateY(${yPos.toFixed(1)}px) scale(${scale.toFixed(4)})`;
      if (this.cachedTransforms[i] !== transformStr) {
        this.cachedTransforms[i] = transformStr;
        this.lineElements[i].style.transform = transformStr;
      }
    }

    // 入场完成检测
    if (!this.entranceComplete) {
      let allSettled = true;
      for (let i = 0; i < lineCount; i++) {
        if (!this.positionSprings[i].arrived()) {
          allSettled = false;
          break;
        }
      }
      this.entranceComplete = allSettled;
    }

    // 透明度 / pass / 模糊
    const frameDeltaSec = (deltaTime || 16) / 1000;
    const attackFactor = 1 - Math.exp(-this.alphaAttackSpeed * frameDeltaSec);
    const releaseFactor = 1 - Math.exp(-this.alphaReleaseSpeed * frameDeltaSec);
    const blurFactor = 1 - Math.exp(-12 * frameDeltaSec);
    const halfInactive = this.inactiveAlpha * 0.5;
    const doPass = this.hidePassedLines && this.isPlaying;
    const doBlur = this.enableBlur;
    const blurSuppressed = this.isUserScrolling || this.isHovering;
    const activeIdx = this.activeLineIndex;

    for (let i = 0; i < lineCount; i++) {
      const yPos = this.positionSprings[i].getCurrentPosition();
      if (!isFullSync && (yPos < -500 || yPos > viewHeight + 500)) continue;

      const isActive = this.activeLineSet.has(i);
      const isPassed =
        doPass && !this.isUserScrolling && (this.lines[i].isBG ? i - 1 < activeIdx : i < activeIdx);

      // alpha：亮色（--ba）和暗色（--da）分别插值
      const alphaIdx = i * 2;
      const targetBright = isPassed ? 0.0001 : isActive ? 1.0 : this.inactiveAlpha;
      let brightValue = this.alphaValues[alphaIdx];
      if (Math.abs(targetBright - brightValue) < 0.001) {
        brightValue = targetBright;
      } else {
        const factor =
          !isPassed && brightValue < halfInactive
            ? releaseFactor
            : targetBright > brightValue
              ? attackFactor
              : releaseFactor;
        brightValue += (targetBright - brightValue) * factor;
      }
      this.alphaValues[alphaIdx] = brightValue;

      const targetDark = isPassed
        ? 0.0001
        : this.enableWordHighlight
          ? this.inactiveAlpha
          : targetBright;
      let darkValue = this.alphaValues[alphaIdx + 1];
      if (Math.abs(targetDark - darkValue) < 0.001) {
        darkValue = targetDark;
      } else {
        const factor =
          !isPassed && darkValue < halfInactive
            ? releaseFactor
            : targetDark > darkValue
              ? attackFactor
              : releaseFactor;
        darkValue += (targetDark - darkValue) * factor;
      }
      this.alphaValues[alphaIdx + 1] = darkValue;

      // 缓存对比，仅变化时写入 DOM
      const brightStr = brightValue.toFixed(3);
      const darkStr = darkValue.toFixed(3);
      const alphaKey = brightStr + darkStr;
      if (this.cachedAlphaKeys[i] !== alphaKey) {
        this.cachedAlphaKeys[i] = alphaKey;
        const lineEl = this.lineElements[i];
        lineEl.style.setProperty("--ba", brightStr);
        lineEl.style.setProperty("--da", darkStr);
      }

      // pass：已播放行淡出
      if (doPass || this.passValues[i] < 0.999) {
        const targetPass = isPassed ? 0.0001 : 1;
        let passValue = this.passValues[i];
        if (Math.abs(targetPass - passValue) < 0.001) passValue = targetPass;
        else passValue += (targetPass - passValue) * releaseFactor;
        this.passValues[i] = passValue;
        const passKey = passValue.toFixed(3);
        if (this.cachedPassKeys[i] !== passKey) {
          this.cachedPassKeys[i] = passKey;
          this.lineElements[i].style.setProperty("--pass", passKey);
        }
      }

      // blur：逐行模糊，距激活行越远越模糊
      if (doBlur || this.blurValues[i] > 0.01) {
        let targetBlur = 0;
        if (doBlur && !blurSuppressed && !isActive) {
          targetBlur = Math.min(4, 1 + Math.abs(i - Math.max(activeIdx, 0)));
        }
        let blurCurrent = this.blurValues[i];
        if (Math.abs(targetBlur - blurCurrent) < 0.01) blurCurrent = targetBlur;
        else blurCurrent += (targetBlur - blurCurrent) * blurFactor;
        this.blurValues[i] = blurCurrent;
        const blurKey = blurCurrent.toFixed(2);
        if (this.cachedBlurKeys[i] !== blurKey) {
          this.cachedBlurKeys[i] = blurKey;
          this.lineElements[i].style.setProperty("--blur", blurKey);
        }
      }
    }

    // 间奏圆点呼吸动画
    renderInterludeDots(
      playTime,
      this.interludeState,
      this.dotsContainer,
      this.dotElements,
      this.interludeCache,
      this.breatheCycleTarget,
    );
  };

  /**
   * 为指定行按需创建动画并播放（懒创建：仅在行激活时调用）
   * @param lineIndex - 行索引
   * @param currentTime - 当前播放时间（毫秒）
   */
  private createAndPlayLineAnimations = (lineIndex: number, currentTime: number) => {
    // 清理该行旧动画（上一次停用时保留的）
    const oldAnims = this.activeAnimations.get(lineIndex);
    if (oldAnims)
      for (const anim of oldAnims) {
        anim.onfinish = null;
        anim.cancel();
      }

    const targets = this.lineAnimTargets[lineIndex];
    if (!targets?.length || (!this.enableFloatAnimation && !this.enableEmphasizeEffect)) return;

    const line = this.lines[lineIndex];
    const relativeTime = Math.max(0, currentTime - line.startTime);
    const anims: Animation[] = [];

    for (const target of targets) {
      // 基础上浮动画
      if (this.enableFloatAnimation) {
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
      if (this.enableEmphasizeEffect && target.isEmphasize && target.charElements.length > 0) {
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
      const computedTiming = anim.effect?.getComputedTiming();
      const animEndTime =
        ((computedTiming?.delay as number) || 0) + ((computedTiming?.duration as number) || 0);
      if (this.isPlaying && relativeTime < animEndTime) anim.play();
      else anim.pause();
    }

    this.activeAnimations.set(lineIndex, anims);
  };

  /**
   * 停用行动画：
   * - float 反向播放实现平滑回落
   * - glow/scale 保持当前状态，随行透明度自然淡出
   * - 动画完成后自动清理，避免累积
   * @param lineIndex - 行索引
   */
  private deactivateLineAnimations = (lineIndex: number) => {
    const anims = this.activeAnimations.get(lineIndex);
    if (!anims) return;

    // 统计未完成的动画数量，全部完成后自动清理
    let pendingCount = anims.length;
    const tryCleanup = () => {
      if (--pendingCount > 0) return;
      // 所有动画均已完成，若该行仍非激活则清理
      if (!this.activeLineSet.has(lineIndex)) {
        const currentAnims = this.activeAnimations.get(lineIndex);
        if (currentAnims === anims) {
          for (const anim of anims) anim.cancel();
          this.activeAnimations.delete(lineIndex);
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
  };

  /** 清理所有非激活行的残留动画，释放合成资源 */
  private cleanupInactiveAnimations = () => {
    for (const [lineIdx, anims] of this.activeAnimations) {
      if (this.activeLineSet.has(lineIdx)) continue;
      for (const anim of anims) anim.cancel();
      this.activeAnimations.delete(lineIdx);
    }
  };

  /** 取消所有行的动画并清空映射 */
  private cancelAllActiveAnimations = () => {
    for (const [, anims] of this.activeAnimations) for (const anim of anims) anim.cancel();
    this.activeAnimations.clear();
  };

  /**
   * 歌词行点击
   * @param event - 鼠标事件
   */
  private handleLineClick = (event: MouseEvent) => {
    if (!this.lineClickCallback) return;
    const lineEl = (event.target as HTMLElement).closest(".lp-line") as HTMLDivElement | null;
    if (!lineEl) return;
    const lineIdx = this.lineElements.indexOf(lineEl);
    if (lineIdx !== -1 && this.lines[lineIdx])
      this.lineClickCallback(this.lines[lineIdx].startTime);
  };

  /**
   * 应用用户滚动偏移并设置回弹定时器
   * @param deltaY - 滚动偏移量
   */
  private applyUserScroll = (deltaY: number) => {
    // 首次进入滚动时清理残留动画，减少合成开销
    if (!this.isUserScrolling) this.cleanupInactiveAnimations();
    this.userScrollOffset += deltaY;
    this.isUserScrolling = true;
    this.calculateLayout(false);
    clearTimeout(this.scrollResetTimerId);
    this.scrollResetTimerId = window.setTimeout(() => {
      this.isUserScrolling = false;
      this.userScrollOffset = 0;
      this.measureLineHeights();
      this.calculateLayout(false);
    }, this.scrollResetDelay);
  };

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.applyUserScroll(event.deltaY);
  };

  private handleTouchStart = (event: TouchEvent) => {
    this.lastTouchY = event.touches[0].clientY;
  };

  private handleTouchMove = (event: TouchEvent) => {
    event.preventDefault();
    const currentY = event.touches[0].clientY;
    this.applyUserScroll(this.lastTouchY - currentY);
    this.lastTouchY = currentY;
  };

  private handleTouchEnd = () => {
    if (!this.isUserScrolling) return;
    clearTimeout(this.scrollResetTimerId);
    this.scrollResetTimerId = window.setTimeout(() => {
      this.isUserScrolling = false;
      this.userScrollOffset = 0;
      this.measureLineHeights();
      this.calculateLayout(false);
    }, this.scrollResetDelay);
  };

  private handleMouseEnter = () => {
    this.isHovering = true;
  };

  /** 鼠标离开：恢复模糊 + 回弹滚动位置 */
  private handleMouseLeave = () => {
    this.isHovering = false;
    if (this.isUserScrolling) {
      clearTimeout(this.scrollResetTimerId);
      this.isUserScrolling = false;
      this.userScrollOffset = 0;
      this.measureLineHeights();
      this.calculateLayout(false, true);
    }
  };

  /** 容器尺寸变化：重新测量 + 重算掩码 + 重新布局 */
  private handleContainerResize = () => {
    const newWidth = this.container.clientWidth;
    const newHeight = this.container.clientHeight;
    if (newWidth === this.containerWidth && newHeight === this.containerHeight) return;
    this.containerWidth = newWidth;
    this.containerHeight = newHeight;
    this.measureLineHeights();
    measureAndApplyWordMasks(this.wordMeasurements, this.wordFadeWidth, this.lines);
    // 入场动画期间跳过 calculateLayout，避免 setPosition 瞬移破坏弹簧入场
    if (!this.entranceComplete) {
      this.needsFullSync = true;
      return;
    }
    this.calculateLayout(true);
    this.needsFullSync = true;
  };

  /** 哨兵行尺寸变化（字体/样式变化时触发） */
  private handleSentinelResize = () => {
    if (this.lineElements.length === 0) return;
    this.dotsContainerWidth = this.dotsContainer.offsetWidth || 60;
    this.dotsContainerHeight = this.dotsContainer.offsetHeight || 20;
    this.measureLineHeights();
    measureAndApplyWordMasks(this.wordMeasurements, this.wordFadeWidth, this.lines);
    // 入场动画期间跳过 calculateLayout，避免 setPosition 瞬移破坏弹簧入场
    if (!this.entranceComplete) {
      this.needsFullSync = true;
      return;
    }
    this.calculateLayout(true);
    this.needsFullSync = true;
  };

  /** 页面可见性变化：不可见时跳过渲染，恢复时全量同步 */
  private handleVisibilityChange = () => {
    this.isPageVisible = !document.hidden;
    if (this.isPageVisible) {
      this.lastFrameTimestamp = 0;
      this.measureLineHeights();
      // 兜底布局
      if (this.pendingPlayTime >= 0) {
        this.handleSeek(this.pendingPlayTime);
      } else {
        this.calculateLayout(true);
      }
      this.needsFullSync = true;
    }
  };

  /** 将当前弹簧参数应用到所有弹簧实例 */
  private applySpringParams = () => {
    const config = this.springParams;
    for (const spring of this.positionSprings) spring.updateParams(config);
    for (const spring of this.scaleSprings)
      spring.updateParams({ mass: 2, damping: 25, stiffness: 100 });
  };
}
