import type { PlayerState, AudioDevice, RepeatMode, ShuffleMode } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import type { ContentScope } from "@/types/collection";
export type { RepeatMode, ShuffleMode } from "@shared/types/player";
import * as queue from "./queue";

export const useStatusStore = defineStore(
  "status",
  () => {
    /** 播放状态 */
    const state = ref<PlayerState>("idle");
    /** 播放位置 */
    const position = ref(0);
    /** 播放时长 */
    const duration = ref(0);
    /** 音量 */
    const volume = ref(1);
    /** FFT 数据 */
    const fftData = shallowRef<number[]>([]);
    /** 当前音源 */
    const currentSource = ref<string | null>(null);
    /** 输出设备 */
    const outputDevices = ref<AudioDevice[]>([]);
    /** 歌曲加载 */
    const trackLoading = ref(false);
    /** 菜单折叠状态 */
    const isExpanded = ref(false);
    /** 播放列表状态 */
    const playlistOpen = ref(false);
    /** 搜索弹窗状态 */
    const searchOpen = ref(false);
    /** 全屏播放器是否展示歌词 */
    const showLyric = ref(true);
    /** 当前播放索引 */
    const playIndex = ref(-1);
    /** 循环模式 */
    const repeatMode = ref<RepeatMode>("list");
    /** 随机模式 */
    const shuffleMode = ref<ShuffleMode>("off");
    /** 心动模式 */
    const heartMode = ref(false);
    /** 私人 FM 模式 */
    const fmMode = ref(false);
    /** 播放速度（0.5 ~ 2.0），不持久化 */
    const speed = ref(1.0);
    /** 音调偏移（半音 -12 ~ 12），不持久化 */
    const pitch = ref(0);
    /** 音调同步：true = 变速保音调（默认），不持久化 */
    const pitchSync = ref(true);
    /**定时关闭 */
    const autoClose = reactive({
      enable: false,
      duration: 30, // 分钟
      endTime: 0, // Unix ms
      waitSongEnd: false,
      remainTime: 0, // 秒
    });
    /** AB 循环 */
    const abLoop = reactive({
      enable: false,
      pointA: null as number | null,
      pointB: null as number | null,
    });
    /** 当前曲目歌词偏移（ms，正值为歌词提前） */
    const lyricOffsetMs = ref(0);
    /** 搜索页选中的平台 */
    const searchPlatform = ref<Platform>("netease");
    /** 侧栏「我的歌单」当前展示来源 */
    const myPlaylistSource = ref<ContentScope>("local");
    /** 「我喜欢的音乐」页当前 tab */
    const likedPageTab = ref<ContentScope>("local");
    /** 是否正在播放 */
    const isPlaying = computed(() => state.value === "playing");
    /** 是否暂停 */
    const isPaused = computed(() => state.value === "paused");
    /** 是否加载中 */
    const isLoading = computed(() => trackLoading.value);
    /** 播放进度 */
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
      searchOpen,
      showLyric,
      outputDevices,
      playIndex,
      repeatMode,
      shuffleMode,
      heartMode,
      fmMode,
      speed,
      pitch,
      pitchSync,
      autoClose,
      abLoop,
      lyricOffsetMs,
      searchPlatform,
      myPlaylistSource,
      likedPageTab,
      currentTrack,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: [
        "playIndex",
        "repeatMode",
        "shuffleMode",
        "heartMode",
        "volume",
        "position",
        "searchPlatform",
        "myPlaylistSource",
        "likedPageTab",
      ],
    },
  },
);
