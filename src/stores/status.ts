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
    const result = await window.api.player.load(source);
    if (result.success && result.data) {
      const media = useMediaStore();
      media.setFromLoadResult(result.data);
      duration.value = result.data.track.duration;
      position.value = 0;
      state.value = "playing";
      currentSource.value = source;
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
      state.value = "stopped";
      position.value = 0;
    }
  };

  /** 跳转到指定位置（毫秒） */
  const seek = async (posMs: number): Promise<void> => {
    const result = await window.api.player.seek(posMs);
    if (handleResult(result)) {
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
        state.value = event.data.state;
        position.value = event.data.position;
        duration.value = event.data.duration;
        volume.value = event.data.volume;
        break;
      case "ended":
        state.value = "stopped";
        position.value = duration.value;
        break;
      case "error":
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
