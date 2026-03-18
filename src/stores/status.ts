import type { PlayerState, PlayerEvent, IpcResponse } from "@/types/player";
import { useMediaStore } from "./media";
import * as playback from "@/services/playback";

export const useStatusStore = defineStore("status", () => {
  /** 播放状态 */
  const state = ref<PlayerState>("idle");
  /** 当前播放位置（毫秒），低频更新，用于进度条等 UI */
  const position = ref(0);
  /** 总时长（毫秒） */
  const duration = ref(0);
  /** 音量（0.0 ~ 1.0） */
  const volume = ref(1);
  /** FFT 频谱数据 */
  const fftData = shallowRef<number[]>([]);
  /** 错误信息 */
  const error = ref<string | null>(null);
  /** 当前加载的音频源路径 */
  const currentSource = ref<string | null>(null);

  /** 是否正在播放 */
  const isPlaying = computed(() => state.value === "playing");
  /** 是否已暂停 */
  const isPaused = computed(() => state.value === "paused");
  /** 是否加载中 */
  const isLoading = computed(() => state.value === "loading");
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

  /** 同步播放状态到非响应式时间源 */
  const syncPlayback = (newState: PlayerState): void => {
    playback.setPlaying(newState === "playing");
    if (newState === "stopped" || newState === "idle") {
      playback.reset();
    }
  };

  /** 加载音频源 */
  const load = async (source: string): Promise<void> => {
    error.value = null;
    state.value = "loading";
    playback.reset();

    const result = await window.api.player.load(source);
    if (result.success && result.data) {
      const media = useMediaStore();
      media.setFromLoadResult(result.data);

      const dur = result.data.track.duration;
      duration.value = dur;
      position.value = 0;
      state.value = "playing";
      currentSource.value = source;

      playback.setDuration(dur);
      playback.setCurrentTime(0);
      playback.setPlaying(true);
    } else {
      state.value = "idle";
      error.value = result.error ?? "Failed to load";
    }
  };

  /** 恢复播放 */
  const play = async (): Promise<void> => {
    const result = await window.api.player.play();
    if (handleResult(result)) {
      state.value = "playing";
      playback.setPlaying(true);
    }
  };

  /** 暂停播放 */
  const pause = async (): Promise<void> => {
    const result = await window.api.player.pause();
    if (handleResult(result)) {
      state.value = "paused";
      playback.setPlaying(false);
    }
  };

  /** 停止播放 */
  const stop = async (): Promise<void> => {
    const result = await window.api.player.stop();
    if (handleResult(result)) {
      state.value = "stopped";
      position.value = 0;
      playback.reset();
    }
  };

  /** 跳转到指定位置（毫秒） */
  const seek = async (posMs: number): Promise<void> => {
    const result = await window.api.player.seek(posMs);
    if (handleResult(result)) {
      position.value = posMs;
      playback.setCurrentTime(posMs);
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
        // 同步到非响应式时间源
        playback.setCurrentTime(event.data.position);
        playback.setDuration(event.data.duration);
        syncPlayback(event.data.state);
        break;
      case "position":
        position.value = event.data.position;
        playback.setCurrentTime(event.data.position);
        if (event.data.duration > 0) {
          duration.value = event.data.duration;
          playback.setDuration(event.data.duration);
        }
        break;
      case "ended":
        state.value = "stopped";
        position.value = duration.value;
        playback.setPlaying(false);
        break;
      case "error":
        error.value = event.error;
        break;
    }
  };

  let unsubscribe: (() => void) | null = null;

  /** 初始化事件监听 */
  const init = (): void => {
    if (unsubscribe) unsubscribe();
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
