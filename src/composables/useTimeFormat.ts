import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { formatTime } from "@/utils/time";
import type { TimeFormat } from "@/types/settings";

/** 歌曲播放时间显示类型 */
type TimeDisplayType = "current" | "total" | "remaining";

// 歌曲播放时间显示格式所对应的两个时间的显示类型
const timeFormatConfig: Record<TimeFormat, [TimeDisplayType, TimeDisplayType]> = {
  "current-total": ["current", "total"],
  "remaining-total": ["remaining", "total"],
  "current-remaining": ["current", "remaining"],
};

// 所有的歌曲播放时间显示格式
const timeFormats = Object.keys(timeFormatConfig) as TimeFormat[];

/**
 * 歌曲播放时间格式化
 * 支持点击切换时间显示格式（已播放/总时长、剩余/总时长、已播放/剩余）
 */
export const useTimeFormat = () => {
  const statusStore = useStatusStore();
  const settingsStore = useSettingsStore();

  /**
   * 获取时间显示字符串
   * @param index - 值在 timeFormatConfig 的数组中的 index
   */
  const useTimeDisplay = (index: 0 | 1) =>
    computed(() => {
      const display = timeFormatConfig[settingsStore.player.timeFormat][index];
      switch (display) {
        case "current":
          return formatTime(statusStore.position);
        case "total":
          return formatTime(statusStore.duration);
        case "remaining":
          return "-" + formatTime(statusStore.duration - statusStore.position);
        default:
          return "";
      }
    });

  /** 切换时间格式 */
  const toggleTimeFormat = () => {
    const currentIndex = timeFormats.indexOf(settingsStore.player.timeFormat);
    settingsStore.player.timeFormat = timeFormats[(currentIndex + 1) % timeFormats.length];
  };

  return {
    timeDisplay: [useTimeDisplay(0), useTimeDisplay(1)] as const,
    toggleTimeFormat,
  };
};
