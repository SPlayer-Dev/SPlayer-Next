import { defineStore } from "pinia";
import { shallowRef, ref } from "vue";
import type { Track, TrackDetail, LyricFormat } from "@/types/song";
import type { LoadResult } from "@/types/player";

/** 当前使用的歌词来源 */
export type ActiveLyric =
  | { type: "embedded" }
  | { type: "external"; format: LyricFormat }
  | null;

export const useMediaStore = defineStore("media", () => {
  /** 当前歌曲轻量信息 */
  const track = shallowRef<Track | null>(null);

  /** 当前歌曲详细信息 */
  const detail = shallowRef<TrackDetail | null>(null);

  /** 当前选中的歌词来源 */
  const activeLyric = ref<ActiveLyric>(null);

  /** 从 load 返回结果写入，自动选择默认歌词 */
  const setFromLoadResult = (result: LoadResult): void => {
    track.value = result.track;
    detail.value = result.detail;

    // 默认选第一个可用歌词：外部优先，其次内嵌
    if (result.detail.externalLyrics.length > 0) {
      activeLyric.value = {
        type: "external",
        format: result.detail.externalLyrics[0].format,
      };
    } else if (result.detail.embeddedLyric) {
      activeLyric.value = { type: "embedded" };
    } else {
      activeLyric.value = null;
    }
  };

  /** 切换歌词来源 */
  const setActiveLyric = (lyric: ActiveLyric): void => {
    activeLyric.value = lyric;
  };

  /** 清空 */
  const clear = (): void => {
    track.value = null;
    detail.value = null;
    activeLyric.value = null;
  };

  return { track, detail, activeLyric, setFromLoadResult, setActiveLyric, clear };
}, {
  persist: {
    storage: sessionStorage,
    pick: ["track", "activeLyric"],
  },
});
