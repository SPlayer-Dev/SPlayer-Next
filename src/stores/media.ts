import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricFormat, LyricLine, LyricSource } from "@/types/lyric";
import { bestExternalIndex, detectFormat, parseLyric, findLyricIndex } from "@/utils/lyric/parse";

export const useMediaStore = defineStore("media", () => {
  /** 当前歌曲轻量信息 */
  const track = shallowRef<Track | null>(null);

  /** 当前歌曲详细信息 */
  const detail = shallowRef<TrackDetail | null>(null);

  /** 当前选中的歌词来源 */
  const activeLyric = ref<LyricSource>(null);

  /** 当前歌词原始内容（按需加载） */
  const lyricContent = ref<string | null>(null);

  /** 当前歌词格式 */
  const lyricFormat = computed((): LyricFormat | null => activeLyric.value?.format ?? null);

  /** 当前歌词解析结果 */
  const parsedLyric = computed((): LyricLine[] => {
    const content = lyricContent.value;
    const format = lyricFormat.value;
    if (!content || !format) return [];
    try {
      return parseLyric(content, format);
    } catch {
      return [];
    }
  });

  /** 当前歌词行索引，-1 表示无匹配 */
  const lyricIndex = ref(-1);

  /**
   * 根据播放时间更新歌词行索引
   * 由 status store 在收到 position 推送时调用
   * @param time 当前播放时间（毫秒）
   */
  const updateLyricIndex = (time: number): void => {
    lyricIndex.value = findLyricIndex(parsedLyric.value, time, lyricIndex.value);
  };

  /**
   * 加载当前选中歌词的内容
   */
  const loadLyricContent = async (): Promise<void> => {
    const det = detail.value;
    const active = activeLyric.value;
    if (!det || !active) {
      lyricContent.value = null;
      return;
    }
    if (active.type === "embedded") {
      lyricContent.value = det.embeddedLyric ?? null;
    } else {
      const lyric = det.externalLyrics.find((l) => l.format === active.format);
      if (!lyric) {
        lyricContent.value = null;
        return;
      }
      const result = await window.api.player.readLyricFile(lyric.path);
      lyricContent.value = result.success ? (result.data ?? null) : null;
    }
    // 重置索引
    lyricIndex.value = -1;
  };

  /**
   * 设置当前歌曲，自动按优先级选择歌词并加载内容
   * @param newTrack 歌曲轻量信息
   * @param newDetail 歌曲详细信息
   */
  const setTrack = async (newTrack: Track, newDetail?: TrackDetail): Promise<void> => {
    track.value = newTrack;
    if (!newDetail) return;
    detail.value = newDetail;

    // 外置优先，按格式优先级选择
    const idx = bestExternalIndex(newDetail.externalLyrics);
    if (idx !== -1) {
      activeLyric.value = {
        type: "external",
        format: newDetail.externalLyrics[idx].format,
      };
    } else if (newDetail.embeddedLyric) {
      activeLyric.value = { type: "embedded", format: detectFormat(newDetail.embeddedLyric) };
    } else {
      activeLyric.value = null;
    }

    await loadLyricContent();
  };

  /**
   * 手动切换歌词来源并加载内容
   * @param source 目标歌词来源
   */
  const switchLyric = async (source: LyricSource): Promise<void> => {
    activeLyric.value = source;
    await loadLyricContent();
  };

  /** 清空所有状态 */
  const clear = (): void => {
    track.value = null;
    detail.value = null;
    activeLyric.value = null;
    lyricContent.value = null;
    lyricIndex.value = -1;
  };

  return {
    track,
    detail,
    activeLyric,
    lyricFormat,
    lyricContent,
    parsedLyric,
    lyricIndex,
    updateLyricIndex,
    setTrack,
    switchLyric,
    clear,
  };
});
