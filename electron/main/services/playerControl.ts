/**
 * 播放控制聚合入口
 *
 * 把"外部来源"（系统媒体、HTTP/WS 外部 API、插件）发起的播放控制
 * 收敛到一处：引擎直控 + 必要时通知渲染层补记账。
 */

import { randomUUID } from "node:crypto";
import { getMainWindow } from "@main/window";
import { queueQuerySchema } from "@main/services/music";
import { getPlayer } from "@main/services/engine";
import * as neteaseScrobble from "@main/services/neteaseScrobble";
import * as lastfm from "@main/services/lastfm";
import { sendToMain } from "@main/utils/broadcast";
import { toMs } from "@main/utils/time";
import type { ShuffleMode, RepeatMode, Track, PlayerState } from "@shared/types/player";
import type {
  PlaybackStatusSnapshot,
  PlaybackQueueOptions,
  PlaybackQueueSnapshot,
} from "@shared/types/music";
import { getTrayPlayMode } from "@main/services/tray";

let currentIndex = -1;

/**
 * 跳转（毫秒）
 *
 * 返回的 Promise 透传引擎结果：WS/REST 等外部入口据此反馈失败；插件侧即发即忘，自行忽略即可。
 * @param positionMs - 目标位置（毫秒）
 */
const seek = (positionMs: number): Promise<void> => {
  sendToMain("player:event", { type: "seek", data: { position: positionMs } });
  return getPlayer().seek(positionMs / 1000);
};

/**
 * 向主窗口按需读取队列，超时自动移除响应监听
 * @param options - 队列偏移与返回条数
 * @returns 当前播放顺序的队列分页及播放索引
 */
const getQueue = async (options: PlaybackQueueOptions = {}): Promise<PlaybackQueueSnapshot> => {
  const query = queueQuerySchema.parse(options);
  const window = getMainWindow();
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    throw new Error("Playback window is unavailable");
  }
  const requestId = randomUUID();
  const channel = `player:queue-response:${requestId}`;
  const ipc = window.webContents.ipc;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ipc.removeListener(channel, receive);
      reject(new Error("Reading the playback queue timed out"));
    }, 5000);
    /**
     * 完成当前查询并释放超时任务
     * @param _event - 主窗口的进程通信事件
     * @param snapshot - 渲染进程读取的队列快照
     */
    const receive = (_event: Electron.IpcMainEvent, snapshot: PlaybackQueueSnapshot): void => {
      clearTimeout(timer);
      resolve(snapshot);
    };
    ipc.once(channel, receive);
    window.webContents.send("player:event", { type: "getQueue", data: { requestId, ...query } });
  });
};

export const playerControl = {
  getQueue,
  /**
   * 保存主窗口同步的队列索引，供各外部入口共用
   * @param index - 当前队列索引，无当前队列项时为 -1
   */
  syncQueueIndex: (index: number): void => {
    currentIndex = index;
  },
  /**
   * 读取播放状态并统一时间单位为毫秒
   * @returns 播放状态、当前队列索引、音量与播放模式
   */
  getStatus: (): PlaybackStatusSnapshot => {
    const status = getPlayer().getStatus();
    return {
      state: status.state as PlayerState,
      positionMs: toMs(status.position),
      durationMs: toMs(status.duration),
      volume: status.volume,
      isFinished: status.isFinished,
      currentIndex,
      ...getTrayPlayMode(),
    };
  },
  play: (): void =>
    void getPlayer()
      .play()
      .catch(() => {}),
  pause: (): void => getPlayer().pause(),
  stop: (): void => {
    neteaseScrobble.onStopped();
    lastfm.onStopped();
    getPlayer().stop();
  },
  next: (): void => sendToMain("player:event", { type: "next" }),
  prev: (): void => sendToMain("player:event", { type: "prev" }),
  setShuffle: (mode: ShuffleMode): void =>
    sendToMain("player:event", { type: "setShuffle", data: { mode } }),
  setRepeat: (mode: RepeatMode): void =>
    sendToMain("player:event", { type: "setRepeat", data: { mode } }),
  playTrack: (track: Track): void =>
    sendToMain("player:event", { type: "playTrack", data: { track } }),
  addToQueue: (tracks: Track[], position: "next" | "end"): void =>
    sendToMain("player:event", { type: "addToQueue", data: { tracks, position } }),
  seek,
  setVolume: (volume: number): void => getPlayer().setVolume(volume),
  /** 当前播放进度（毫秒） */
  getPosition: (): number => toMs(getPlayer().getPosition()),
};
