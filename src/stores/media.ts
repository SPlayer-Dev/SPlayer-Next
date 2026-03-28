import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricFormat, LyricLine, LyricSource } from "@/types/lyric";
import { bestExternalIndex, detectFormat, parseLyric, findLyricIndex } from "@/utils/lyric/parse";
import { loadLyricContent } from "@/services/lyricLoader";

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

  /** 歌词是否正在加载 */
  const lyricLoading = ref(false);

  /** 当前歌词行索引，-1 表示无匹配 */
  const lyricIndex = ref(-1);

  /** 歌词加载竞态 token */
  let lyricToken = 0;

  /**
   * 根据播放时间更新歌词行索引
   * 由 status store 在收到 position 推送时调用
   * @param time 当前播放时间（毫秒）
   */
  const updateLyricIndex = (time: number): void => {
    lyricIndex.value = findLyricIndex(parsedLyric.value, time, lyricIndex.value);
  };

  /**
   * 设置当前歌曲信息（同步，立即更新 UI）
   * 传 detail 时同步选择歌词源，但不加载歌词内容
   */
  const setTrack = (newTrack: Track, newDetail?: TrackDetail): void => {
    track.value = newTrack;
    if (!newDetail) return;
    detail.value = newDetail;

    // 同步选择歌词源：外置优先
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
  };

  /**
   * 加载歌词内容（调用 lyricLoader 服务获取数据，自己管状态）
   */
  const loadLyric = async (): Promise<void> => {
    const token = ++lyricToken;
    const det = detail.value;
    const active = activeLyric.value;
    if (!det || !active) {
      lyricContent.value = null;
      lyricLoading.value = false;
      return;
    }
    lyricLoading.value = true;
    try {
      const content = await loadLyricContent(det, active);
      // 竞态保护：加载期间如果已切歌，丢弃结果
      if (token !== lyricToken) return;
      lyricContent.value = content;
      lyricIndex.value = -1;
    } finally {
      if (token === lyricToken) lyricLoading.value = false;
    }
  };

  /**
   * 手动切换歌词来源并加载内容
   * @param source 目标歌词来源
   */
  const switchLyric = async (source: LyricSource): Promise<void> => {
    activeLyric.value = source;
    await loadLyric();
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
    lyricLoading,
    lyricIndex,
    updateLyricIndex,
    setTrack,
    loadLyric,
    switchLyric,
    clear,
  };
});
