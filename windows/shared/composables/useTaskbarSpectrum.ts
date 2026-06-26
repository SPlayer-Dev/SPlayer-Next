/**
 * 任务栏频谱数据处理
 * 参照 WinIsland：对数频率映射、自适应峰值归一化、静音门控、前端 rise/fall 平滑
 * 参数可配置：灵敏度（增益）、平滑度（rise/fall 衰减）
 *
 * FFT 数据说明：Rust 端 fft.rs 输出 128 个对数间隔 bins，覆盖 80~16000Hz
 * 因此前端 bar 映射必须用对数比例直接索引 bins，而非线性 freq * binPerHz
 *
 * 归一化策略：global peak（所有 bins 的最大值）而非 per-bar peak
 * - per-bar peak 在高频段长期无信号时累积到 floor，导致高频 bar 永远不动
 * - global peak 让高频 bar 即使绝对值小，相对比例也能体现
 * - 配合 sqrt 非线性增强，让小信号占比更大，起伏更明显
 *
 * 静态 frame 检测：当主窗口 BottomSpectrum 卸载后 FFT 推送关闭，
 * 但 currentFftFrame 引用未变，每帧基于同一份数据计算会导致低频 bar 维持高值
 * 因此需要检测 frame 引用是否更新，未更新时视为静音
 */

import { getNowPlayingFftFrame } from "@windows/shared/composables/useNowPlayingSync";

/** FFT 输出 bins 数（与 Rust fft.rs OUTPUT_BINS 一致） */
const FFT_BINS = 128;

/** 自适应峰值归一化参数 */
const PEAK_INITIAL = 0.5;
const PEAK_DECAY = 0.995;
const PEAK_FLOOR = 0.05;

/** 频谱柱条数（固定 24，与 TaskbarLyrics 一致） */
const BAR_COUNT = 24;

export interface TaskbarSpectrumOptions {
  /** 灵敏度增益（0.5~3.0），作用于归一化后的值 */
  sensitivity?: number | (() => number);
  /** 平滑度（0~0.9），越大 rise 越慢、起伏越平滑 */
  smoothing?: number | (() => number);
}

/** 读取可能为 getter 的数值 */
const readNum = (v: number | (() => number) | undefined, fallback: number): number => {
  if (v === undefined) return fallback;
  if (typeof v === "function") return v();
  return v;
};

export function useTaskbarSpectrum(options: TaskbarSpectrumOptions = {}) {
  const bars = shallowRef<number[]>(new Array(BAR_COUNT).fill(0));
  const isSilent = ref(true);

  let rafId = 0;
  let visible = true;

  /** 平滑后的柱条高度 */
  const smoothed = new Float32Array(BAR_COUNT);
  /** 自适应全局峰值（所有 bins 的最大值） */
  let globalPeak = PEAK_INITIAL;
  /** 上一帧时间戳 */
  let lastFrameTime = 0;
  /** 上一次读取的 frame 引用，用于检测是否更新 */
  let lastFrameRef: readonly number[] | null = null;
  /** frame 未更新的最大容忍帧数（超过则视为静音） */
  let staleFrameCount = 0;

  /**
   * 预计算每个显示 bar 对应的 FFT bin 范围
   * FFT bins 是对数间隔分布（Rust 端 80~16000Hz），共 FFT_BINS 个
   * 显示 bars 同样按对数间隔分布，bar j 直接映射到 bins [j*FFT_BINS/BAR_COUNT, (j+1)*FFT_BINS/BAR_COUNT]
   * 这样每个 bar 覆盖的频率范围在 log 域是等宽的，与 FFT bins 自然对齐
   */
  const barBinRanges: Array<{ start: number; end: number }> = [];
  for (let j = 0; j < BAR_COUNT; j++) {
    const start = Math.floor((j * FFT_BINS) / BAR_COUNT);
    const end = Math.max(start + 1, Math.floor(((j + 1) * FFT_BINS) / BAR_COUNT));
    barBinRanges.push({ start, end });
  }

  const processFrame = (now: number): void => {
    /* 每帧读取最新配置，支持动态调整 */
    const sensitivity = readNum(options.sensitivity, 1.0);
    const smoothing = readNum(options.smoothing, 0.5);
    const FRONTEND_RISE = 0.6 * (1 - smoothing * 0.8);
    const FRONTEND_FALL = 0.08 + smoothing * 0.2;
    const SILENCE_GATE = 0.002 * sensitivity;

    if (!lastFrameTime) lastFrameTime = now;
    const elapsedFrames = Math.max(0.5, Math.min(2.4, (now - lastFrameTime) / 16.67));
    lastFrameTime = now;

    const frame = getNowPlayingFftFrame();

    /* 检测 frame 是否更新：
     * - 引用未变：FFT 推送已关闭（BottomSpectrum 卸载），视为静音
     * - 空数组：初始化状态，视为静音
     * 连续 3 帧未更新才进入静音处理，避免偶尔的 IPC 抖动误判
     */
    const isStale = !frame || frame.length === 0 || frame === lastFrameRef;
    if (isStale) {
      staleFrameCount++;
    } else {
      staleFrameCount = 0;
      lastFrameRef = frame;
    }
    const shouldMute = staleFrameCount > 3;

    if (shouldMute) {
      let allSilent = true;
      for (let i = 0; i < BAR_COUNT; i++) {
        const target = 0;
        const rate = 1 - Math.pow(1 - FRONTEND_FALL, elapsedFrames);
        smoothed[i] = smoothed[i] + (target - smoothed[i]) * rate;
        if (smoothed[i] > 0.01) allSilent = false;
      }
      globalPeak = Math.max(PEAK_FLOOR, globalPeak * PEAK_DECAY);
      const result = new Array<number>(BAR_COUNT);
      for (let i = 0; i < BAR_COUNT; i++) result[i] = smoothed[i];
      bars.value = result;
      isSilent.value = allSilent;
      return;
    }

    const binCount = frame.length;
    const result = new Array<number>(BAR_COUNT);
    let allSilent = true;

    /* 计算 global peak：所有 bins 的最大值
     * 用于归一化，避免高频 bar 因 per-bar peak 累积导致永远不动
     */
    let globalMax = 0;
    for (let j = 0; j < binCount; j++) {
      const v = frame[j] ?? 0;
      if (v > globalMax) globalMax = v;
    }

    if (globalMax > globalPeak) {
      globalPeak = globalMax;
    } else {
      globalPeak = Math.max(PEAK_FLOOR, globalPeak * PEAK_DECAY);
    }

    for (let i = 0; i < BAR_COUNT; i++) {
      const { start, end } = barBinRanges[i];

      /* 取 bin 范围内的最大值（频谱条更敏感），同时限制不超过实际 bin 数 */
      let max = 0;
      const lo = Math.min(start, binCount - 1);
      const hi = Math.min(end, binCount);
      for (let j = lo; j < hi; j++) {
        const v = frame[j] ?? 0;
        if (v > max) max = v;
      }

      /* 静音门控：低于阈值视为静音 */
      let value = max;
      if (value < SILENCE_GATE) {
        value = 0;
      }

      /* 用 global peak 归一化（而非 per-bar peak） */
      const normalized =
        globalPeak > SILENCE_GATE ? Math.min(1, (value / globalPeak) * sensitivity) : 0;

      /* 非线性增强：sqrt 让小信号占比更大，高频 bar 也能起伏
       * sqrt(0.04) = 0.2，sqrt(0.25) = 0.5，让原本 4% 的信号放大到 20%
       */
      const enhanced = Math.sqrt(normalized);

      /* 前端 rise/fall 平滑（帧率自适应） */
      const baseRate = enhanced > smoothed[i] ? FRONTEND_RISE : FRONTEND_FALL;
      const rate = 1 - Math.pow(1 - baseRate, elapsedFrames);
      smoothed[i] = smoothed[i] + (enhanced - smoothed[i]) * rate;

      if (Math.abs(smoothed[i] - enhanced) < 0.002) {
        smoothed[i] = enhanced;
      }

      result[i] = smoothed[i];
      if (smoothed[i] > 0.02) allSilent = false;
    }

    bars.value = result;
    isSilent.value = allSilent;
  };

  const tick = (now: number): void => {
    if (!visible) return;
    processFrame(now);
    rafId = requestAnimationFrame(tick);
  };

  const onVisibilityChange = (): void => {
    visible = !document.hidden;
    if (visible) {
      lastFrameTime = 0;
      rafId = requestAnimationFrame(tick);
    }
  };

  onMounted(() => {
    document.addEventListener("visibilitychange", onVisibilityChange);
    rafId = requestAnimationFrame(tick);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (rafId) cancelAnimationFrame(rafId);
  });

  return { bars, isSilent };
}
