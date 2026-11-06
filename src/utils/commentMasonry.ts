/** 瀑布流卡片位置 */
export interface MasonryPosition {
  x: number;
  y: number;
}

/** 瀑布流布局结果 */
export interface MasonryLayout {
  positions: MasonryPosition[];
  height: number;
}

/**
 * 将卡片依次放入当前最矮的列，保证同列上下间距恒定
 * @param heights - 每张卡片的实际高度
 * @param columns - 列数
 * @param columnWidth - 列宽
 * @param gap - 卡片间距
 * @returns 每张卡片的位置与容器总高度
 */
export const layoutMasonry = (
  heights: number[],
  columns: number,
  columnWidth: number,
  gap: number,
): MasonryLayout => {
  const columnCount = Math.max(1, columns);
  const columnHeights = new Array<number>(columnCount).fill(0);
  const positions = heights.map((height) => {
    let target = 0;
    for (let index = 1; index < columnCount; index += 1) {
      if (columnHeights[index] < columnHeights[target]) target = index;
    }
    const y = Math.round(columnHeights[target]);
    const x = Math.round(target * (columnWidth + gap));
    columnHeights[target] = y + Math.max(0, height) + gap;
    return { x, y };
  });
  const height = Math.max(0, Math.ceil(Math.max(...columnHeights) - gap));
  return { positions, height };
};
