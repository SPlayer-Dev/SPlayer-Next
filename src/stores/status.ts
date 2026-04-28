import type { PlayerState, AudioDevice, RepeatMode, ShuffleMode } from "@shared/types/player";
export type { RepeatMode, ShuffleMode } from "@shared/types/player";
import * as queue from "./queue";

export const useStatusStore = defineStore(
  "status",
  () => {
    const state = ref<PlayerState>("idle");
    const position = ref(0);
    const duration = ref(0);
    const volume = ref(1);
    const fftData = shallowRef<number[]>([]);
    const currentSource = ref<string | null>(null);
    const outputDevices = ref<AudioDevice[]>([]);
    /** 歌曲加载 */
    const trackLoading = ref(false);
    const isExpanded = ref(false);
    const playlistOpen = ref(false);
    const playIndex = ref(-1);
    const repeatMode = ref<RepeatMode>("list");
    const shuffleMode = ref<ShuffleMode>("off");
    /** 播放速度（0.5 ~ 2.0），不持久化 */
    const speed = ref(1.0);
    /** 音调偏移（半音 -12 ~ 12），不持久化 */
    const pitch = ref(0);
    /** 音调同步：true = 变速保音调（默认），不持久化 */
    const pitchSync = ref(true);

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
      currentSource,
      isPlaying,
      isPaused,
      isLoading,
      progress,
      trackLoading,
      isExpanded,
      playlistOpen,
      outputDevices,
      playIndex,
      repeatMode,
      shuffleMode,
      speed,
      pitch,
      pitchSync,
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
