import type { MediaInfo, Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricFormat, LyricInput, LyricLine } from "@shared/types/lyrics";
import { findLyricIndex } from "@shared/utils/lyric";
import { watchLyricPreference } from "@/services/lyricLoader";
import { parseLyric } from "@/utils/lyric/parse";
import { extractLyricAuthor } from "@/utils/lyric/author";
import { applyLyricExclude } from "@/utils/lyric/lyricStripper";
import { normalizeLyricLines } from "@/utils/lyric/normalize";

export const useMediaStore = defineStore("media", () => {
  watchLyricPreference();

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
  const parsedLyric = shallowRef<LyricLine[]>([]);

  /** 当前歌词文件制作者 */
  const lyricAuthor = ref<string | null>(null);

  /** 同步当前歌词源到主进程 */
  const syncToMain = (): void => {
    try {
      const payload = {
        track: track.value ? toRaw(track.value) : null,
        lyric: toRaw(parsedLyric.value),
        source: activeLyric.value ? toRaw(activeLyric.value) : null,
      };
      window.api.nowPlaying.update(payload);
    } catch (error) {
      console.error("[media] syncToMain failed", error);
    }
  };

  /**
   * 更新 track
   * @param newTrack - 新的歌曲信息
   * @param newDetail - 新的歌曲详细信息；省略则保留现有 detail
   */
  const setTrack = (newTrack: Track, newDetail?: TrackDetail): void => {
    track.value = newTrack;
    if (newDetail) detail.value = newDetail;
  };

  /**
   * 把 audio-engine 解析出的元数据合并到当前 Track 上。
   * 保留身份字段（id/source/serverId/originalId/platform/path）；
   * 对未设置/空值的展示字段做兜底填充（duration/quality）。
   * streaming 源的 cover/title/artist/album 已经是服务器返回的权威值，绝不被引擎覆盖。
   */
  const enrichTrack = (info: MediaInfo, newDetail?: TrackDetail): void => {
    if (!track.value) return;
    const isStreaming = track.value.source === "streaming";
    track.value = {
      ...track.value,
      duration: track.value.duration > 0 ? track.value.duration : info.duration,
      cover: isStreaming ? track.value.cover : (track.value.cover ?? info.cover),
      quality: track.value.quality ?? info.quality,
    };
    if (newDetail) detail.value = newDetail;
  };

  /** 重置歌词状态 */
  const resetLyricState = (): void => {
    activeLyric.value = null;
    lyricContent.value = null;
    parsedLyric.value = [];
    lyricAuthor.value = null;
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
    let nextLines: LyricLine[] = [];
    if (source && input) {
      try {
        const lines = parseLyric(input, source.format);
        nextLines = applyLyricExclude(lines, track.value);
        normalizeLyricLines(nextLines);
      } catch (e) {
        console.error("[media] parse lyric failed:", e);
        nextLines = [];
      }
    }
    // 解析后无有效行视作无歌词
    const hasContent = nextLines.length > 0;
    activeLyric.value = hasContent ? source : null;
    lyricContent.value = hasContent ? input : null;
    parsedLyric.value = nextLines;
    lyricAuthor.value =
      hasContent && source && input ? extractLyricAuthor(input.content, source.format) : null;
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
    parsedLyric.value = [];
    lyricAuthor.value = null;
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
    lyricAuthor,
    lyricLoading,
    lyricIndex,
    setTrack,
    enrichTrack,
    resetLyricState,
    setLyric,
    updateLyricIndex,
    clear,
  };
});
