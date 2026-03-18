import { getCurrentTime, getDuration, isPlaying } from "@/services/playback";

/**
 * 高频播放时间 composable
 *
 * 用于歌词高亮、频谱可视化等需要逐帧更新的组件。
 * 通过 RAF 循环读取非响应式时间源，不触发 Vue 响应式系统。
 *
 * @param onTick 每帧回调，接收当前播放位置（毫秒）和总时长（毫秒）
 */
export const usePlaybackTime = (
  onTick: (currentMs: number, durationMs: number, playing: boolean) => void,
): void => {
  let rafId: number | null = null;

  const tick = (): void => {
    onTick(getCurrentTime(), getDuration(), isPlaying());
    rafId = requestAnimationFrame(tick);
  };

  onMounted(() => {
    rafId = requestAnimationFrame(tick);
  });

  onUnmounted(() => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  });
};
