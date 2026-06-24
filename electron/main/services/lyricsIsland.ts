/**
 * ClassIsland 联动服务（LyricsIsland 协议客户端）
 *
 * 订阅 nowPlaying 事件，按协议向 ClassIsland（ExtraIsland 插件）推送当前歌词。
 * 协议：POST http://127.0.0.1:{port}/component/lyrics/lyrics/
 * 请求体：{ "lyric": "<主歌词>", "extra": "<次级歌词>" }
 */

import type { Track } from "@shared/types/player";
import type { LyricLine } from "@shared/types/lyrics";
import type {
  NowPlayingSnapshot,
  NowPlayingPositionSync,
  NowPlayingLyricOffsetSync,
} from "@shared/types/nowPlaying";
import { store } from "@main/store";
import { lyricsIslandLog } from "@main/utils/logger";
import * as nowPlaying from "@main/services/nowPlaying";

/** 缓存的当前歌词行数组 */
let lyricLines: LyricLine[] = [];
/** 当前行索引，-1 表示未匹配 */
let currentIndex = -1;
/** 当前歌词偏移（毫秒，正值为歌词提前） */
let lyricOffsetMs = 0;
/** 事件订阅取消函数列表 */
let unsubscribers: Array<() => void> = [];

/**
 * 从一行歌词中提取纯文本
 * @param line - 歌词行
 * @returns 拼接后的文本
 */
const lineToText = (line: LyricLine): string => line.words.map((w) => w.word).join("");

/**
 * 按时间查找当前歌词行索引
 * 找到 startTime <= time 的最后一行
 * @param time - 查找时间（毫秒）
 * @returns 行索引，-1 表示无匹配
 */
const findIndex = (time: number): number => {
  let result = -1;
  for (let i = 0; i < lyricLines.length; i++) {
    if (lyricLines[i].startTime <= time) result = i;
    else break;
  }
  return result;
};

/**
 * 发送歌词到 ClassIsland
 * 请求失败静默吞掉，不打印日志（ClassIsland 可能未运行）
 * @param lyric - 主歌词
 * @param extra - 次级歌词
 */
const send = async (lyric: string, extra: string): Promise<void> => {
  const port = store.get("lyricsIsland.port");
  const url = `http://127.0.0.1:${port}/component/lyrics/lyrics/`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lyric, extra }),
    });
  } catch {
    // ClassIsland 未运行或端口被占用，静默忽略
  }
};

/**
 * 处理歌曲切换
 * @param data - 含新 track，null 表示无曲目
 */
const onTrackChange = (data: { track: Track | null }): void => {
  if (!store.get("lyricsIsland.enabled")) return;
  lyricLines = [];
  currentIndex = -1;
  const track = data.track;
  if (!track) return;
  const artist = track.artists.map((a) => a.name).join(", ");
  void send(track.title, artist);
};

/**
 * 处理歌词内容变化
 * @param snap - 当前播放快照
 */
const onLyricChange = (snap: NowPlayingSnapshot): void => {
  if (!store.get("lyricsIsland.enabled")) return;
  lyricLines = snap.lyric;
  currentIndex = -1;
  lyricOffsetMs = snap.lyricOffsetMs;
};

/**
 * 处理歌词偏移变化
 * @param data - 偏移数据
 */
const onLyricOffsetChange = (data: NowPlayingLyricOffsetSync): void => {
  if (!store.get("lyricsIsland.enabled")) return;
  lyricOffsetMs = data.offsetMs;
};

/**
 * 处理播放位置变化
 * @param data - 位置同步数据
 */
const onPositionSync = (data: NowPlayingPositionSync): void => {
  if (!store.get("lyricsIsland.enabled")) return;
  if (lyricLines.length === 0) return;
  const time = data.position + lyricOffsetMs;
  const next = findIndex(time);
  if (next === currentIndex) return;
  currentIndex = next;
  const current = next >= 0 ? lyricLines[next] : null;
  const nextLine = next + 1 < lyricLines.length ? lyricLines[next + 1] : null;
  const lyric = current ? lineToText(current) : "";
  let extra = "";
  if (store.get("lyricsIsland.showTranslation") && current?.translatedLyric) {
    extra = current.translatedLyric;
  } else if (store.get("lyricsIsland.showNextLine") && nextLine) {
    extra = lineToText(nextLine);
  }
  void send(lyric, extra);
};

/**
 * 初始化服务：订阅 nowPlaying 事件
 * 无论 enabled 是否开启都订阅，在回调中实时检查 enabled，使配置变更立即生效
 */
export const init = (): void => {
  if (unsubscribers.length > 0) return;
  lyricsIslandLog.info("初始化 ClassIsland 联动服务");
  unsubscribers = [
    nowPlaying.onTrackChange(onTrackChange),
    nowPlaying.onLyricChange(onLyricChange),
    nowPlaying.onLyricOffsetChange(onLyricOffsetChange),
    nowPlaying.onPositionSync(onPositionSync),
  ];
};

/** 清理：取消所有事件订阅，重置内部状态 */
export const dispose = (): void => {
  if (unsubscribers.length === 0) return;
  lyricsIslandLog.info("关闭 ClassIsland 联动服务");
  for (const unsub of unsubscribers) {
    try {
      unsub();
    } catch {
      // ignored
    }
  }
  unsubscribers = [];
  lyricLines = [];
  currentIndex = -1;
  lyricOffsetMs = 0;
};
