import type { MediaInfo, PlaybackContext, Track, TrackDetail } from "@shared/types/player";
import type { LyricFormat, LyricInput, LyricLine } from "lyric-kit";
import type { LyricData } from "@shared/types/lyrics";

import { useSettingsStore } from "@/stores/settings";
import { watchLyricPreference } from "@/services/lyric/loader";
import {
  applyLyricLanguages,
  clampLastLineEnd,
  extractLyricAuthors,
  findLyricIndex,
  normalizeLyricLines,
  parseLyric,
} from "lyric-kit";
import { applyLyricExclude } from "@/utils/lyric/lyricStripper";
import { applyLyricCjkTransform } from "@/utils/lyric/cjkTransform";

export const useMediaStore = defineStore("media", () => {
  watchLyricPreference();

  /** 当前歌曲轻量信息 */
  const track = shallowRef<Track | null>(null);

  /** 当前播放的来源上下文 */
  const playbackContext = shallowRef<PlaybackContext>();

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
  const wordTimed = computed(() => activeLyric.value?.wordTimed ?? false);

  /** 当前歌词解析结果 */
  const parsedLyric = shallowRef<LyricLine[]>([]);

  /** 当前歌词文件制作者列表 */
  const lyricAuthors = ref<string[]>([]);

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
   * 更新当前播放的来源上下文
   * @param context - 播放来源上下文
   */
  const setPlaybackContext = (context?: PlaybackContext): void => {
    playbackContext.value = context;
  };

  /**
   * 把 audio-engine 解析出的元数据合并到当前 Track 上
   * 保留身份字段（id/source/serverId/originalId/platform/path）
   * 对未设置/空值的展示字段做兜底填充（duration/quality）
   * streaming 源的 cover/title/artist/album 已经是服务器返回的权威值，绝不被引擎覆盖
   */
  const enrichTrack = (info: MediaInfo, newDetail?: TrackDetail): void => {
    if (!track.value) return;
    const isStreaming = track.value.source === "streaming";
    // 标题为文件名去后缀派生（如拖拽播放）时，让位给引擎提取的内嵌标签标题
    const fileName = track.value.path?.split(/[\\/]/).pop() ?? "";
    const stem = fileName.replace(/\.[^.]+$/, "");
    const hasExplicitTitle = !!track.value.title && track.value.title !== stem;
    const hasExplicitArtists = track.value.artists && track.value.artists.length > 0;
    track.value = {
      ...track.value,
      title: hasExplicitTitle ? track.value.title : info.title || track.value.title,
      artists: hasExplicitArtists
        ? track.value.artists
        : info.artists && info.artists.length > 0
          ? info.artists
          : track.value.artists,
      album: track.value.album ?? info.album,
      duration: track.value.duration > 0 ? track.value.duration : info.duration,
      cover: isStreaming ? track.value.cover : (track.value.cover ?? info.cover),
      quality: track.value.quality ?? info.quality,
    };
    if (newDetail) detail.value = newDetail;
  };

  /**
   * 兜底封面：当前 track 无封面时把插件命中的远端 URL 填进去
   * 同时写 cover 与 coverOriginal，使全屏大图与背景/取色一并补上；已有封面不覆盖
   * @param url - 封面图片 URL
   */
  const patchCover = (url: string): void => {
    if (!track.value) return;
    if (track.value.cover && track.value.coverOriginal) return;
    track.value = {
      ...track.value,
      cover: track.value.cover || url,
      coverOriginal: track.value.coverOriginal || url,
    };
  };

  /** 重置歌词状态 */
  const resetLyricState = (): void => {
    transformToken++;
    activeLyric.value = null;
    lyricContent.value = null;
    parsedLyric.value = [];
    lyricAuthors.value = [];
    lyricIndex.value = -1;
    lyricLoading.value = true;
    syncToMain();
  };

  /** 简繁转换竞态 token */
  let transformToken = 0;

  // 从原文重新解析，关闭自动生成后不会残留估算时间戳
  watch(
    () => [useSettingsStore().lyric.cjkTransform, useSettingsStore().lyric.autoGenerateWordByWord],
    () => {
      if (activeLyric.value && lyricContent.value) {
        setLyric(activeLyric.value, lyricContent.value);
      }
    },
  );

  /**
   * 原子写入歌词
   * @param source - 歌词源
   * @param input - 主歌词 + 可选翻译 / 音译；传 null 即清空
   */
  const setLyric = (source: LyricData, input: LyricInput | null): void => {
    const token = ++transformToken;
    let nextLines: LyricLine[] = [];
    let authors: string[] = [];
    let hasWordTiming = false;
    const settings = useSettingsStore();
    if (source && input) {
      try {
        const result = parseLyric(
          {
            content: input.content,
            format: source.format,
            translation: input.translation,
            translationFormat: input.translationFormat,
            romaji: input.romaji,
            romajiFormat: input.romajiFormat,
          },
          {
            detectBackground: settings.lyric.detectBackgroundLyrics,
            preferredLang: settings.locale,
            cleanKangxi: true,
            extractMetadata: true,
          },
        );
        nextLines = applyLyricExclude(result.lines, track.value);
        normalizeLyricLines(nextLines);
        nextLines = clampLastLineEnd(nextLines, track.value?.duration);
        const segmenter = settings.lyric.autoGenerateWordByWord
          ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
          : null;
        for (const line of nextLines) {
          const timed =
            (line.words.length > 1 ||
              ["ttml", "lys", "yrc", "qrc", "krc"].includes(source.format)) &&
            line.words.some((word) => word.endTime > word.startTime);
          if (timed) {
            hasWordTiming = true;
            continue;
          }
          if (!segmenter || line.endTime <= line.startTime) continue;
          const text = line.words.map((word) => word.word).join("");
          const characters = Array.from(segmenter.segment(text), (part) => part.segment);
          if (!characters.length) continue;
          const duration = line.endTime - line.startTime;
          line.words = characters.map((word, index) => ({
            word,
            startTime: line.startTime + Math.round((duration * index) / characters.length),
            endTime: line.startTime + Math.round((duration * (index + 1)) / characters.length),
          }));
          hasWordTiming = true;
        }
        applyLyricLanguages(nextLines);
        authors = result.metadata.authors?.length
          ? result.metadata.authors
          : extractLyricAuthors(input.content, source.format);
      } catch (e) {
        console.error("[media] parse lyric failed:", e);
        nextLines = [];
      }
    }
    // 解析后无有效行视作无歌词
    const hasContent = nextLines.length > 0;
    activeLyric.value = hasContent && source ? { ...source, wordTimed: hasWordTiming } : null;
    lyricContent.value = hasContent ? input : null;
    parsedLyric.value = nextLines;
    lyricAuthors.value = hasContent && source && input ? authors : [];
    lyricIndex.value = -1;
    lyricLoading.value = false;
    syncToMain();

    // 应用 OpenCC 简繁转换
    const cjkMode = settings.lyric.cjkTransform;
    if (hasContent && cjkMode && cjkMode !== "none") {
      applyLyricCjkTransform(nextLines, cjkMode).then((transformed) => {
        if (token !== transformToken) return;
        parsedLyric.value = transformed;
        syncToMain();
      });
    }
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
    transformToken++;
    track.value = null;
    playbackContext.value = undefined;
    detail.value = null;
    activeLyric.value = null;
    lyricContent.value = null;
    parsedLyric.value = [];
    lyricAuthors.value = [];
    lyricLoading.value = false;
    lyricIndex.value = -1;
    syncToMain();
  };

  return {
    track,
    playbackContext,
    detail,
    activeLyric,
    lyricContent,
    lyricFormat,
    wordTimed,
    parsedLyric,
    lyricAuthors,
    lyricLoading,
    lyricIndex,
    setTrack,
    setPlaybackContext,
    enrichTrack,
    patchCover,
    resetLyricState,
    setLyric,
    updateLyricIndex,
    clear,
  };
});
