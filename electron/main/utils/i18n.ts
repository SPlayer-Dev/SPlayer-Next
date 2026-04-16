import type { LocaleCode } from "@shared/types/settings";

interface MainMessages {
  prev: string;
  play: string;
  pause: string;
  next: string;
  shuffle: string;
  sequential: string;
  repeatList: string;
  repeatOne: string;
  repeatOff: string;
  openDesktopLyric: string;
  closeDesktopLyric: string;
  openDynamicIsland: string;
  closeDynamicIsland: string;
  quit: string;
}

const messages: Record<LocaleCode, MainMessages> = {
  "zh-CN": {
    prev: "上一曲",
    play: "播放",
    pause: "暂停",
    next: "下一曲",
    shuffle: "随机播放",
    sequential: "顺序播放",
    repeatList: "列表循环",
    repeatOne: "单曲循环",
    repeatOff: "不循环",
    openDesktopLyric: "开启桌面歌词",
    closeDesktopLyric: "关闭桌面歌词",
    openDynamicIsland: "开启灵动岛",
    closeDynamicIsland: "关闭灵动岛",
    quit: "退出",
  },
  "en-US": {
    prev: "Previous",
    play: "Play",
    pause: "Pause",
    next: "Next",
    shuffle: "Shuffle",
    sequential: "Sequential",
    repeatList: "Repeat All",
    repeatOne: "Repeat One",
    repeatOff: "No Repeat",
    openDesktopLyric: "Open Desktop Lyric",
    closeDesktopLyric: "Close Desktop Lyric",
    openDynamicIsland: "Open Dynamic Island",
    closeDynamicIsland: "Close Dynamic Island",
    quit: "Quit",
  },
};

let currentLocale: LocaleCode = "zh-CN";

/** 获取翻译文本 */
export const t = (key: keyof MainMessages): string => messages[currentLocale][key];

/** 切换语言，返回是否发生变化 */
export const setLocale = (locale: LocaleCode): boolean => {
  if (currentLocale === locale) return false;
  currentLocale = locale;
  return true;
};

/** 获取当前语言 */
export const getLocale = (): LocaleCode => currentLocale;
