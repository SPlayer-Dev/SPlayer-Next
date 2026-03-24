import type { PlayerState, AudioDevice } from "@shared/types/player";
import * as queue from "./queue";

/** 循环模式 */
export type RepeatMode = "off" | "list" | "one";

/** 随机模式 */
export type ShuffleMode = "off" | "on";

export const useStatusStore = defineStore(
  "status",
  () => {
    const state = ref<PlayerState>("idle");
    const position = ref(0);
    const duration = ref(0);
    const volume = ref(1);
    const fftData = shallowRef<number[]>([]);
    const error = ref<string | null>(null);
    const currentSource = ref<string | null>(null);
    const outputDevices = ref<AudioDevice[]>([]);
    const selectedDeviceName = ref<string | null>(null);
    const isExpanded = ref(false);
    const playIndex = ref(-1);
    const repeatMode = ref<RepeatMode>("list");
    const shuffleMode = ref<ShuffleMode>("off");

    const isPlaying = computed(() => state.value === "playing");
    const isPaused = computed(() => state.value === "paused");
    const isLoading = computed(() => state.value === "loading");
    const progress = computed(() => (duration.value > 0 ? position.value / duration.value : 0));
    /**
     * 当前播放索引对应的 Track，从队列按 playIndex 实时读取
     * 与 media.track 的区别：playIndex 变化后立即更新，用于 player.ts 决定下一步该 load 哪首
     * media.track 在 load 成功后才更新，用于组件显示已加载完成的歌曲信息
     */
    const currentTrack = computed(() => queue.getTrack(playIndex.value));

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
      playIndex,
      repeatMode,
      shuffleMode,
      currentTrack,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: ["playIndex", "repeatMode", "shuffleMode", "volume", "position", "duration"],
    },
  },
);
