import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import { findLyricIndex } from "@shared/utils/lyric";
import { formatTime } from "@/utils/time";

/**
 * 进度条歌词相关功能
 * - 悬浮提示显示歌词
 * - 进度调节吸附歌词
 */
export const useProgressLyric = () => {
  const settingsStore = useSettingsStore();
  const mediaStore = useMediaStore();

  /**
   * 获取指定时间对应的歌词文本
   * @param time - 播放时间（毫秒）
   * @returns 歌词文本，无匹配返回 null
   */
  const getLyricAtTime = (time: number): string | null => {
    const lyrics = mediaStore.parsedLyric;
    if (!lyrics.length) return null;

    const index = findLyricIndex(lyrics, time);
    if (index === -1) return null;

    const line = lyrics[index];
    // 获取歌词文本
    const text = line.words?.map((w) => w.word).join("") || line.translatedLyric || "";
    if (!text) return null;

    // 截断过长的歌词
    return text.length > 30 ? text.slice(0, 30) + "..." : text;
  };

  /**
   * 格式化进度条提示信息
   * @param time - 播放时间（毫秒）
   * @returns 格式化的提示文本
   */
  const formatTooltip = (time: number): string => {
    const timeStr = formatTime(time);
    if (!settingsStore.player.showProgressLyric) return timeStr;
    const lyric = getLyricAtTime(time);
    return lyric ? `${timeStr} / ${lyric}` : timeStr;
  };

  /**
   * 吸附到最近的歌词行
   * @param time - 目标时间（毫秒）
   * @returns 吸附后的时间，无吸附返回原值
   */
  const snapToNearestLyric = (time: number): number => {
    if (!settingsStore.player.snapToLyric) return time;

    const lyrics = mediaStore.parsedLyric;
    if (!lyrics.length) return time;

    const currentIdx = findLyricIndex(lyrics, time);

    // 优先检查下一行（预备开始）
    const nextIdx = currentIdx + 1;
    if (nextIdx < lyrics.length) {
      const nextLine = lyrics[nextIdx];
      // 距离下一行开头 2.5 秒内，吸附到下一行
      if (nextLine.startTime - time <= 2500) {
        return nextLine.startTime;
      }
    }

    // 检查当前行（重新开始）
    if (currentIdx !== -1) {
      const currentLine = lyrics[currentIdx];
      const offset = time - currentLine.startTime;
      // 距离当前行开头 10 秒内，吸附到当前行
      if (offset <= 10000) {
        return currentLine.startTime;
      }
    }

    return time;
  };

  return {
    formatTooltip,
    snapToNearestLyric,
  };
};
