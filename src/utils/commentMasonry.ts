/**
 * 计算瀑布流卡片占用的网格行数
 * @param height - 卡片实际内容高度（px）
 * @param rowHeight - 网格行高（px）
 * @param gap - 网格间距（px）
 * @returns 至少 1 的行数
 */
export const getMasonryRowSpan = (height: number, rowHeight: number, gap: number): number =>
  Math.max(1, Math.ceil((height + gap) / (rowHeight + gap)));
