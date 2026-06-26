/**
 * 灵动岛频谱处理
 * 参照 WinIsland audio.rs + music_view.rs：6 频段、自适应归一化、频段重映射
 * 关键改进：平滑与 FFT 到达解耦，每 RAF 帧都推进平滑，实现 60fps 实时动效
 * 支持 numBands 参数：6（默认，含重映射）或 10（纯音乐模式，对数分布无重映射）
 */
import { getNowPlayingFftFrame } from "@windows/shared/composables/useNowPlayingSync";

/** 6 频段范围（基于 128-bin FFT，参照 WinIsland 的 [(2,8),(8,20),(20,50),(50,120),(120,280),(280,511)] 按比例缩放） */
const BAND_RANGES_6: ReadonlyArray<readonly [number, number]> = [
  [2, 6],
  [6, 14],
  [14, 30],
  [30, 55],
  [55, 85],
  [85, 127],
];

/** 6 频段重映射权重（参照 WinIsland final_bins） */
const BAND_REMAP_6 = [5, 3, 0, 1, 2, 4];
const BAND_WEIGHTS_6 = [0.8, 0.9, 1.0, 1.0, 0.9, 0.8];

/** 自适应归一化系数（参照 WinIsland 0.995/0.005） */
const ADAPTIVE_DECAY = 0.995;
const ADAPTIVE_RISE = 0.005;
const ADAPTIVE_GAIN = 2.3;

/** 非对称平滑系数（参照 WinIsland rise=0.6, fall=0.08） */
const RISE = 0.6;
const FALL = 0.08;

/** 静音门控阈值（参照 WinIsland 0.002） */
const SILENCE_GATE = 0.002;

/**
 * 为任意频段数生成对数分布的频段范围
 * @param numBands - 频段数
 * @returns [lo, hi] 数组，基于 128-bin FFT
 */
const generateLogBandRanges = (numBands: number): Array<readonly [number, number]> => {
  const ranges: Array<readonly [number, number]> = [];
  const minBin = 2;
  const maxBin = 127;
  const logMin = Math.log(minBin);
  const logMax = Math.log(maxBin);
  const step = (logMax - logMin) / numBands;
  for (let i = 0; i < numBands; i++) {
    const lo = Math.max(minBin, Math.round(Math.exp(logMin + i * step)));
    const hi = Math.min(maxBin, Math.round(Math.exp(logMin + (i + 1) * step)));
    ranges.push([lo, Math.max(lo + 1, hi)]);
  }
  return ranges;
};

export interface SpectrumDrawOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  barWidth?: number;
  barGap?: number;
  maxHeight?: number;
  minHeight?: number;
  /** 调色板颜色数组 [primary, secondary, primary] */
  palette: string[];
  /** 是否正在播放（暂停时频谱塌缩到 minHeight） */
  playing?: boolean;
  /** 频谱样式：gradient 斜向渐变 / solid 纯色 / minimal 极简细线 */
  spectrumStyle?: "gradient" | "solid" | "minimal";
}

export function useIslandSpectrum(numBands: number = 6) {
  const useRemap = numBands === 6;
  const bandRanges = useRemap ? BAND_RANGES_6 : generateLogBandRanges(numBands);
  const bandRemap = useRemap ? BAND_REMAP_6 : Array.from({ length: numBands }, (_, i) => i);
  const bandWeights = useRemap
    ? BAND_WEIGHTS_6
    : Array.from({ length: numBands }, (_, i) => {
        const center = (numBands - 1) / 2;
        const dist = Math.abs(i - center) / center;
        return 1.0 - dist * 0.2;
      });

  /** 每个频段的自适应最大值 */
  const adaptiveMax = new Float32Array(numBands).fill(0.01);
  /** 平滑后的频段值（像素高度比例 0~1） */
  const smoothed = new Float32Array(numBands).fill(0);
  /** 目标频段值（FFT 到达时更新，平滑每帧推进） */
  const target = new Float32Array(numBands).fill(0);
  /** 上一帧的 FFT 数据引用，用于检测新帧 */
  let lastFftRef: number[] = [];
  /** 是否正在播放 */
  let isPlaying = false;

  /**
   * 从 128-bin FFT 数据中提取频段
   */
  const extractBands = (fftData: number[]): Float32Array => {
    const bands = new Float32Array(numBands);
    for (let i = 0; i < numBands; i++) {
      const [lo, hi] = bandRanges[i];
      let sum = 0;
      let count = 0;
      for (let j = lo; j < hi && j < fftData.length; j++) {
        sum += fftData[j] ?? 0;
        count++;
      }
      bands[i] = count > 0 ? sum / count : 0;
    }
    return bands;
  };

  /**
   * 计算目标频段值（仅在有新 FFT 数据时调用）
   * 参照 WinIsland：自适应最大值 + 频段重映射 + 静音门控
   */
  const computeTarget = (bands: Float32Array): void => {
    let peak = 0;
    for (let i = 0; i < numBands; i++) {
      peak = Math.max(peak, bands[i]);
    }
    const gate = peak > SILENCE_GATE ? 1 : 0;

    for (let i = 0; i < numBands; i++) {
      const avg = Math.max(bands[i], 0.01);
      adaptiveMax[i] = adaptiveMax[i] * ADAPTIVE_DECAY + avg * ADAPTIVE_RISE;
    }

    for (let i = 0; i < numBands; i++) {
      const srcIdx = bandRemap[i];
      const normalized = Math.min(
        1,
        Math.max(0, bands[srcIdx] / (adaptiveMax[srcIdx] * ADAPTIVE_GAIN)),
      );
      target[i] = normalized * bandWeights[i] * gate;
    }
  };

  /**
   * 每帧推进非对称平滑（参照 WinIsland rise=0.6, fall=0.08）
   * 暂停时 target 归零，频谱平滑塌缩
   */
  const smoothStep = (): void => {
    for (let i = 0; i < numBands; i++) {
      const t = isPlaying ? target[i] : 0;
      if (t > smoothed[i]) {
        smoothed[i] = smoothed[i] * (1 - RISE) + t * RISE;
      } else {
        smoothed[i] = smoothed[i] * (1 - FALL) + t * FALL;
      }
    }
  };

  /**
   * 绘制频谱条
   * 参照 WinIsland draw_visualizer：胶囊形圆角 + 斜向调色板渐变 + 非对称平滑
   * spectrumStyle: gradient 斜向渐变 / solid 纯色 / minimal 极简细线
   */
  const draw = (options: SpectrumDrawOptions): void => {
    const {
      ctx,
      width,
      height,
      barWidth = 3,
      barGap = 2,
      maxHeight = 28,
      minHeight = 3,
      palette,
      playing = true,
      spectrumStyle = "gradient",
    } = options;
    isPlaying = playing;

    const fftData = getNowPlayingFftFrame();
    if (fftData !== lastFftRef && fftData.length > 0) {
      lastFftRef = fftData;
      const bands = extractBands(fftData);
      computeTarget(bands);
    }

    smoothStep();

    ctx.clearRect(0, 0, width, height);

    const totalWidth = numBands * barWidth + (numBands - 1) * barGap;
    const startX = (width - totalWidth) / 2;
    const centerY = height / 2;

    const colors =
      palette.length >= 2 ? palette : ["rgba(255,255,255,0.9)", "rgba(255,255,255,0.5)"];

    if (spectrumStyle === "minimal") {
      ctx.fillStyle = colors[0];
      for (let i = 0; i < numBands; i++) {
        const barHeight = Math.max(minHeight, smoothed[i] * maxHeight);
        const x = startX + i * (barWidth + barGap);
        const y = centerY - barHeight / 2;
        ctx.fillRect(x, y, barWidth, barHeight);
      }
      return;
    }

    if (spectrumStyle === "solid") {
      const barRadius = barWidth / 2;
      ctx.fillStyle = colors[0];
      for (let i = 0; i < numBands; i++) {
        const barHeight = Math.max(minHeight, smoothed[i] * maxHeight);
        const x = startX + i * (barWidth + barGap);
        const y = centerY - barHeight / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, barRadius);
        ctx.fill();
      }
      return;
    }

    const barRadius = barWidth / 2;
    const gradient = ctx.createLinearGradient(
      startX,
      centerY - maxHeight / 2,
      startX + totalWidth,
      centerY + maxHeight / 2,
    );
    const step = 1 / (colors.length - 1);
    for (let i = 0; i < colors.length; i++) {
      gradient.addColorStop(Math.min(1, i * step), colors[i]);
    }
    ctx.fillStyle = gradient;

    for (let i = 0; i < numBands; i++) {
      const barHeight = Math.max(minHeight, smoothed[i] * maxHeight);
      const x = startX + i * (barWidth + barGap);
      const y = centerY - barHeight / 2;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, barRadius);
      ctx.fill();
    }
  };

  const reset = (): void => {
    smoothed.fill(0);
    target.fill(0);
    adaptiveMax.fill(0.01);
    lastFftRef = [];
  };

  return { draw, reset, numBands };
}
