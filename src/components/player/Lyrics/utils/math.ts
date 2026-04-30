/**
 * 通用数学与缓动工具函数
 */

/**
 * 将值限制在指定范围内
 * @param min - 最小值
 * @param value - 输入值
 * @param max - 最大值
 * @returns 限制后的值
 */
export const clamp = (min: number, value: number, max: number) =>
  value < min ? min : value > max ? max : value;

/**
 * 带回弹的缓入缓出曲线
 * @param progress - 进度 (0~1)
 * @returns 缓动后的值
 */
export const easeInOutBack = (progress: number): number => {
  const overshoot = 1.70158 * 1.525;
  return progress < 0.5
    ? ((2 * progress) ** 2 * ((overshoot + 1) * 2 * progress - overshoot)) / 2
    : ((2 * progress - 2) ** 2 * ((overshoot + 1) * (progress * 2 - 2) + overshoot) + 2) / 2;
};

/**
 * 指数缓出曲线
 * @param progress - 进度 (0~1)
 * @returns 缓动后的值
 */
export const easeOutExpo = (progress: number): number =>
  progress === 1 ? 1 : 1 - 2 ** (-10 * progress);

/**
 * 从 Set<number> 中找到最小值
 *
 * 避免使用 Math.min(...set) 展开大集合的开销。
 *
 * @param set - 数字集合
 * @returns 最小值，集合为空时返回 -1
 */
export const setMin = (set: Set<number>): number => {
  let minValue = Infinity;
  for (const value of set) {
    if (value < minValue) minValue = value;
  }
  return minValue === Infinity ? -1 : minValue;
};
