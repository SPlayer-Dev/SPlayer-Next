import { getCurrentTime, getDuration, isPlaying } from "@/services/playback";

/**
 * 高频播放时间 composable
 *
 * 通过 RAF 循环读取非响应式时间源，不触发 Vue 响应式系统。
 * 支持显式 start/stop 控制，避免不需要时白跑 RAF。
 *
 * @param onTick 每帧回调，接收当前播放位置（毫秒，整数）和总时长（毫秒，整数）
 * @returns { start, stop } 手动控制 RAF 循环
 */
export const usePlaybackTime = (
  onTick: (currentMs: number, durationMs: number, playing: boolean) => void,
): { start: () => void; stop: () => void } => {
  let rafId: number | null = null;

  const tick = (): void => {
    onTick(Math.round(getCurrentTime()), Math.round(getDuration()), isPlaying());
    rafId = requestAnimationFrame(tick);
  };

  const start = (): void => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(tick);
  };

  const stop = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  onUnmounted(stop);

  return { start, stop };
};
