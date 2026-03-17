import { defineStore } from "pinia";
import { ref, computed, shallowRef } from "vue";
import type { PlayerState, PlayerEvent, IpcResponse } from "@/types/player";
import { useMediaStore } from "./media";

export const useStatusStore = defineStore("status", () => {
  const state = ref<PlayerState>("idle");
  const position = ref(0);
  const duration = ref(0);
  const volume = ref(1);
  const fftData = shallowRef<number[]>([]);
  const error = ref<string | null>(null);
  const currentSource = ref<string | null>(null);

  /** 上次从主进程同步的位置（毫秒）和本地时间戳 */
  let lastSyncPosition = 0;
  let lastSyncTime = 0;

  /** rAF 句柄 */
  let rafId: number | null = null;

  /** 用 requestAnimationFrame 在两次同步之间插值，保持进度条 60fps 流畅 */
  const startInterpolation = (): void => {
    stopInterpolation();
    const tick = (): void => {
      if (state.value === "playing") {
        const elapsed = performance.now() - lastSyncTime;
        position.value = lastSyncPosition + elapsed;
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
  };

  const stopInterpolation = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const isPlaying = computed(() => state.value === "playing");
  const isPaused = computed(() => state.value === "paused");
  const isLoading = computed(() => state.value === "loading");
  const progress = computed(() => (duration.value > 0 ? position.value / duration.value : 0));

  /** 处理 IPC 返回结果，失败时设置 error */
  const handleResult = (result: IpcResponse): boolean => {
    if (!result.success) {
      error.value = result.error ?? "Unknown error";
      return false;
    }
    return true;
  };

  /** 加载音频源，写入 media store（静态信息）+ status store（播放状态） */
  const load = async (source: string): Promise<void> => {
    error.value = null;
    state.value = "loading";
    stopInterpolation();
    const result = await window.api.player.load(source);
    if (result.success && result.data) {
      const media = useMediaStore();
      media.setFromLoadResult(result.data);
      duration.value = result.data.track.duration;
      position.value = 0;
      lastSyncPosition = 0;
      lastSyncTime = performance.now();
      state.value = "playing";
      currentSource.value = source;
      startInterpolation();
    } else {
      state.value = "idle";
      error.value = result.error ?? "Failed to load";
    }
  };

  const play = async (): Promise<void> => {
    const result = await window.api.player.play();
    if (handleResult(result)) {
      state.value = "playing";
    }
  };

  const pause = async (): Promise<void> => {
    const result = await window.api.player.pause();
    if (handleResult(result)) {
      state.value = "paused";
    }
  };

  const stop = async (): Promise<void> => {
    const result = await window.api.player.stop();
    if (handleResult(result)) {
      stopInterpolation();
      state.value = "stopped";
      position.value = 0;
    }
  };

  /** 跳转到指定位置（毫秒） */
  const seek = async (posMs: number): Promise<void> => {
    const result = await window.api.player.seek(posMs);
    if (handleResult(result)) {
      lastSyncPosition = posMs;
      lastSyncTime = performance.now();
      position.value = posMs;
    }
  };

  const setVolume = async (vol: number): Promise<void> => {
    const result = await window.api.player.setVolume(vol);
    if (handleResult(result)) {
      volume.value = vol;
    }
  };

  /** 处理主进程推送的播放事件 */
  const handleEvent = (event: PlayerEvent): void => {
    switch (event.type) {
      case "status":
        // 状态变化事件：更新全部状态
        state.value = event.data.state;
        duration.value = event.data.duration;
        volume.value = event.data.volume;
        lastSyncPosition = event.data.position;
        lastSyncTime = performance.now();
        position.value = event.data.position;
        if (event.data.state === "playing") {
          startInterpolation();
        } else {
          stopInterpolation();
        }
        break;
      case "position":
        // 位置校准事件：只更新位置，不碰状态
        lastSyncPosition = event.data.position;
        lastSyncTime = performance.now();
        position.value = event.data.position;
        if (event.data.duration > 0) {
          duration.value = event.data.duration;
        }
        break;
      case "ended":
        stopInterpolation();
        state.value = "stopped";
        position.value = duration.value;
        break;
      case "error":
        stopInterpolation();
        error.value = event.error;
        break;
    }
  };

  let unsubscribe: (() => void) | null = null;

  /** 初始化事件监听（main.ts 中调用一次） */
  const init = (): void => {
    if (unsubscribe) return;
    unsubscribe = window.api.player.onEvent(handleEvent);
  };

  /** 清理事件监听 */
  const dispose = (): void => {
    stopInterpolation();
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  return {
    state,
    position,
    duration,
    volume,
    fftData,
    error,
    currentSource,
    isPlaying,
    isPaused,
    isLoading,
    progress,
    load,
    play,
    pause,
    stop,
    seek,
    setVolume,
    init,
    dispose,
  };
});
