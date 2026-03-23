import type { PlayerState, PlayerEvent, IpcResponse, AudioDevice } from "@shared/types/player";
import type { RepeatMode, ShuffleMode, PlaybackEvent } from "@shared/types/playback";
import { useMediaStore } from "./media";
import { useThemeStore } from "./theme";
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
  /** 音频输出设备列表 */
  const outputDevices = ref<AudioDevice[]>([]);
  /** 用户选择的输出设备名称（null = 跟随系统默认） */
  const selectedDeviceName = ref<string | null>(null);
  /** 全屏播放器是否展开 */
  const isExpanded = ref(false);
  /** 循环模式 */
  const repeatMode = ref<RepeatMode>("off");
  /** 随机模式 */
  const shuffleMode = ref<ShuffleMode>("off");
  /** 队列当前索引 */
  const queueIndex = ref(-1);
  /** 队列长度 */
  const queueLength = ref(0);

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
      await media.setTrack(result.data.track, result.data.detail);

      // 无封面时清空封面取色，避免残留上一首的主题色
      if (!result.data.track.cover) {
        useThemeStore().updateCoverColor(null);
      }

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

  /** 刷新输出设备列表 */
  const refreshDevices = async (): Promise<void> => {
    const result = await window.api.player.getOutputDevices();
    if (result.success && result.data) {
      outputDevices.value = result.data;
    }
  };

  /** 切换输出设备（传 null 跟随系统默认） */
  const switchDevice = async (deviceName: string | null): Promise<void> => {
    const result = await window.api.player.setOutputDevice(deviceName);
    if (handleResult(result)) {
      selectedDeviceName.value = deviceName;
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
      case "position": {
        position.value = event.data.position;
        playback.setCurrentTime(event.data.position);
        if (event.data.duration > 0) {
          duration.value = event.data.duration;
          playback.setDuration(event.data.duration);
        }
        // 更新歌词行索引
        const media = useMediaStore();
        media.updateLyricIndex(event.data.position);
        break;
      }
      case "ended":
        // 不在这里停止，主进程 PlaybackService 会自动决定下一步
        // 如果没有下一首，会收到 queue:ended 事件
        playback.setPlaying(false);
        break;
      case "error":
        error.value = event.error;
        break;
      case "deviceChanged":
        refreshDevices();
        break;
    }
  };

  /** 处理主进程推送的播放控制事件 */
  const handlePlaybackEvent = (event: PlaybackEvent): void => {
    switch (event.type) {
      case "queue:changed":
        queueIndex.value = event.data.currentIndex;
        queueLength.value = event.data.length;
        break;
      case "queue:trackChanged": {
        queueIndex.value = event.data.currentIndex;
        const media = useMediaStore();
        media.setTrack(event.data.track);
        break;
      }
      case "queue:ended":
        state.value = "stopped";
        position.value = duration.value;
        playback.setPlaying(false);
        break;
      case "repeat:changed":
        repeatMode.value = event.data.mode;
        break;
      case "shuffle:changed":
        shuffleMode.value = event.data.mode;
        break;
    }
  };

  /** 下一首 */
  const nextTrack = (): void => {
    window.api.playback.next();
  };

  /** 上一首 */
  const prevTrack = (): void => {
    window.api.playback.prev();
  };

  /** 设置循环模式 */
  const setRepeatMode = (mode: RepeatMode): void => {
    window.api.playback.setRepeatMode(mode);
  };

  /** 设置随机模式 */
  const setShuffleMode = (mode: ShuffleMode): void => {
    window.api.playback.setShuffleMode(mode);
  };

  let unsubscribe: (() => void) | null = null;
  let unsubscribePlayback: (() => void) | null = null;

  /** 初始化事件监听 */
  let initialized = false;
  const init = (): void => {
    if (initialized) return;
    initialized = true;
    console.log("[status] init");
    if (unsubscribe) unsubscribe();
    if (unsubscribePlayback) unsubscribePlayback();
    unsubscribe = window.api.player.onEvent(handleEvent);
    unsubscribePlayback = window.api.playback.onEvent(handlePlaybackEvent);
    refreshDevices();
  };

  /** 清理事件监听 */
  const dispose = (): void => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (unsubscribePlayback) {
      unsubscribePlayback();
      unsubscribePlayback = null;
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
    isExpanded,
    outputDevices,
    selectedDeviceName,
    repeatMode,
    shuffleMode,
    queueIndex,
    queueLength,
    load,
    play,
    pause,
    stop,
    seek,
    setVolume,
    refreshDevices,
    switchDevice,
    nextTrack,
    prevTrack,
    setRepeatMode,
    setShuffleMode,
    init,
    dispose,
  };
});
