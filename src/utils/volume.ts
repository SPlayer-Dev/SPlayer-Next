/** 滚轮和快捷键每次调整的滑块位置 */
export const VOLUME_STEP = 0.05;

/** 响度幂指数：电平每降 10 dB 听感减半，对应振幅 = 位置^(1 / 0.602)，半程为 -10 dB */
const LOUDNESS_EXPONENT = 1.66;

/**
 * 将滑块位置转换为线性增益，使听感响度与位置成正比
 * @param position - 滑块位置（0.0 ~ 1.0）
 * @returns 音频线性增益（0.0 ~ 1.0）
 */
export const volumePositionToGain = (position: number): number =>
  // 位置按 1% 取整，避免步进累积的浮点尾差在静音附近留下极小增益
  (Math.round(Math.max(0, Math.min(1, position)) * 100) / 100) ** LOUDNESS_EXPONENT;

/**
 * 将线性增益转换为滑块位置，保证存档增益还原后仍是同一响度
 * @param gain - 音频线性增益（0.0 ~ 1.0）
 * @returns 滑块位置（0.0 ~ 1.0）
 */
export const volumeGainToPosition = (gain: number): number =>
  Math.max(0, Math.min(1, gain)) ** (1 / LOUDNESS_EXPONENT);
