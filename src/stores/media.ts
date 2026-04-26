import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricFormat, LyricInput, LyricLine } from "@shared/types/lyrics";
import { parseLyric } from "@/utils/lyric/parse";
import { findLyricIndex } from "@shared/utils/lyric";

export const useMediaStore = defineStore("media", () => {
  /** 当前歌曲轻量信息 */
  const track = shallowRef<Track | null>(null);

  /** 当前歌曲详细信息 */
  const detail = shallowRef<TrackDetail | null>(null);

  /** 当前选中的歌词数据 */
  const activeLyric = ref<LyricData>(null);

  /** 当前歌词原始内容 */
  const lyricContent = ref<LyricInput | null>(null);

  /** 歌词是否正在加载 */
  const lyricLoading = ref(false);

  /** 当前歌词行索引，-1 表示无匹配 */
  const lyricIndex = ref(-1);

  /** 当前歌词格式 */
  const lyricFormat = computed((): LyricFormat | null => activeLyric.value?.format ?? null);

  /** 当前歌词解析结果 */
  const parsedLyric = computed((): LyricLine[] => {
    const input = lyricContent.value;
    const format = lyricFormat.value;
    if (!input || !format) return [];
    try {
      return parseLyric(input, format);
    } catch {
      return [];
    }
  });

  /** 同步当前歌词源到主进程 */
  const syncToMain = (): void => {
    try {
      const payload = JSON.parse(
        JSON.stringify({
          track: track.value,
          lyric: parsedLyric.value,
          source: activeLyric.value,
        }),
      );
      window.api.nowPlaying.update(payload);
    } catch (error) {
      console.error("[media] syncToMain failed", error);
    }
  };

  /**
   * 更新 track / detail
   * @param newTrack - 新的歌曲信息
   * @param newDetail - 新的歌曲详细信息
   */
  const setTrack = (newTrack: Track, newDetail?: TrackDetail): void => {
    track.value = newTrack;
    detail.value = newDetail ?? null;
  };

  /** 重置歌词状态 */
  const resetLyricState = (): void => {
    activeLyric.value = null;
    lyricContent.value = null;
    lyricIndex.value = -1;
    lyricLoading.value = true;
    syncToMain();
  };

  /**
   * 原子写入歌词
   * @param source - 歌词源
   * @param input - 主歌词 + 可选翻译 / 音译；传 null 即清空
   */
  const setLyric = (source: LyricData, input: LyricInput | null): void => {
    activeLyric.value = source;
    lyricContent.value = input;
    lyricIndex.value = -1;
    lyricLoading.value = false;
    syncToMain();
  };

  /**
   * 根据播放时间更新歌词行索引
   * @param time - 播放时间
   */
  const updateLyricIndex = (time: number): void => {
    lyricIndex.value = findLyricIndex(parsedLyric.value, time, lyricIndex.value);
  };

  /** 清空所有状态 */
  const clear = (): void => {
    track.value = null;
    detail.value = null;
    activeLyric.value = null;
    lyricContent.value = null;
    lyricLoading.value = false;
    lyricIndex.value = -1;
    syncToMain();
  };

  return {
    track,
    detail,
    activeLyric,
    lyricContent,
    lyricFormat,
    parsedLyric,
    lyricLoading,
    lyricIndex,
    setTrack,
    resetLyricState,
    setLyric,
    updateLyricIndex,
    clear,
  };
});
