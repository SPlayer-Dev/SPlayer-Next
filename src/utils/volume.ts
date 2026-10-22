/** 滚轮和快捷键每次调整的滑块位置 */
export const VOLUME_STEP = 0.05;

/**
 * 将感知音量位置转换为线性增益
 * @param position - 滑块位置（0.0 ~ 1.0）
 * @returns 音频线性增益
 */
export const volumePositionToGain = (position: number): number =>
  Math.max(0, Math.min(1, position)) ** 3;

/**
 * 将线性增益转换为感知音量位置，保留已有存档的实际响度
 * @param gain - 音频线性增益（0.0 ~ 1.0）
 * @returns 滑块位置
 */
export const volumeGainToPosition = (gain: number): number =>
  Math.cbrt(Math.max(0, Math.min(1, gain)));
