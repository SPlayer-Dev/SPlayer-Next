/**
 * 格式化播放次数为大数简写
 * - 中文：万 (10^4)、亿 (10^8)
 * - 英文：k (10^3)、M (10^6)、B (10^9)
 */
export const formatPlayCount = (count: number, locale: string): string => {
  if (count < 100000) return String(count);
  if (locale.startsWith("zh")) {
    if (count >= 100000000) {
      const v = count / 100000000;
      return `${v.toFixed(1)}亿`;
    }
    const v = count / 10000;
    return `${v.toFixed(1)}万`;
  }
  if (count >= 1000000000) {
    const v = count / 1000000000;
    return `${v.toFixed(1)}B`;
  }
  if (count >= 1000000) {
    const v = count / 1000000;
    return `${v.toFixed(1)}M`;
  }
  const v = count / 1000;
  return `${v.toFixed(1)}k`;
};
