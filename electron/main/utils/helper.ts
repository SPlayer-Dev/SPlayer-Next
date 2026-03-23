
/**
 * Fisher-Yates 洗牌算法
 * 原地打乱数组，O(n) 时间 O(1) 额外空间
 */
 export const shuffleArray = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};