import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { MusicMetadata, PlayerStatus, PlayerEvent, IpcResponse } from "@/types/player";

export const usePlayerStore = defineStore("player", () => {
  const state = ref<PlayerStatus["state"]>("idle");
  const position = ref(0);
  const duration = ref(0);
  const volume = ref(1);
  const metadata = ref<MusicMetadata | null>(null);
  const fftData = ref<number[]>([]);
  const error = ref<string | null>(null);
  const currentSource = ref<string | null>(null);

  /** 是否正在播放 */
  const isPlaying = computed(() => state.value === "playing");
  /** 是否已暂停 */
  const isPaused = computed(() => state.value === "paused");
  /** 播放进度（0 ~ 1） */
  const progress = computed(() => (duration.value > 0 ? position.value / duration.value : 0));

  /** 处理 IPC 返回结果，失败时设置 error */
  const handleResult = (result: IpcResponse): boolean => {
    if (!result.success) {
      error.value = result.error ?? "Unknown error";
      return false;
    }
    return true;
  };

  /** 加载音频源（一次调用获取全部元信息：封面 + 歌词 + 基本信息） */
  const load = async (source: string): Promise<void> => {
    error.value = null;
    const result = await window.api.player.load(source);
    if (result.success && result.data) {
      metadata.value = result.data;
      duration.value = result.data.duration;
      position.value = 0;
      state.value = "playing";
      currentSource.value = source;
    } else {
      error.value = result.error ?? "Failed to load";
    }
  };

  /** 恢复播放 */
  const play = async (): Promise<void> => {
    const result = await window.api.player.play();
    if (handleResult(result)) {
      state.value = "playing";
    }
  };

  /** 暂停播放 */
  const pause = async (): Promise<void> => {
    const result = await window.api.player.pause();
    if (handleResult(result)) {
      state.value = "paused";
    }
  };

  /** 停止播放 */
  const stop = async (): Promise<void> => {
    const result = await window.api.player.stop();
    if (handleResult(result)) {
      state.value = "stopped";
      position.value = 0;
    }
  };

  /** 跳转到指定位置（秒） */
  const seek = async (pos: number): Promise<void> => {
    const result = await window.api.player.seek(pos);
    if (handleResult(result)) {
      position.value = pos;
    }
  };

  /** 设置音量（0.0 ~ 1.0） */
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

  // 事件订阅
  let unsubscribe: (() => void) | null = null;

  /** 初始化事件监听 */
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
    // 状态
    state,
    position,
    duration,
    volume,
    metadata,
    fftData,
    error,
    currentSource,
    // 计算属性
    isPlaying,
    isPaused,
    progress,
    // 操作
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
