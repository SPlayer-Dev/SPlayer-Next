/**
 * 格式化毫秒为 m:ss
 * @param ms 毫秒
 * @returns 格式化后的时间
 */
export const formatTime = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
};

/**
 * 格式化毫秒为 m:ss.d
 * @param ms 毫秒
 * @returns 格式化后的时间
 */
export const formatTimeWithDeci = (ms: number): string => {
  const totalDeci = Math.floor(ms / 100);
  const min = Math.floor(totalDeci / 600);
  const sec = Math.floor(totalDeci / 10) % 60;
  const deci = totalDeci % 10;
  return `${min}:${sec.toString().padStart(2, "0")}.${deci}`;
};

/**
 * 倒计时格式化（输入秒），自动选择 m:ss 或 h:mm:ss
 * @param totalSec 总秒数
 * @returns 格式化后的时间
 */
export const formatCountdown = (totalSec: number): string => {
  const safe = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};
