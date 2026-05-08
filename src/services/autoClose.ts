/**
 * 定时关闭服务
 *
 * 用户设定 N 分钟后停止播放。两种模式：
 * - 立即停：到点直接 pause()
 * - 等本曲结束：到点把 waitSongEnd 标记置位，下次 ended 事件触发时再 pause()
 */

import { useStatusStore } from "@/stores/status";
import * as player from "@/core/player";

/** 倒计时 setInterval 句柄 */
let tickHandle: ReturnType<typeof setInterval> | null = null;
/** "等本曲结束"模式下，时间到了但还没 pause —— 等 ended 事件触发 */
let pendingPauseOnEnd = false;

const stopTick = (): void => {
  if (tickHandle !== null) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
};

/** 倒计时 tick：每秒刷新 remainTime；归零后按模式触发 pause */
const tick = (): void => {
  const status = useStatusStore();
  const { autoClose } = status;
  if (!autoClose.enable) {
    stopTick();
    return;
  }
  const remainMs = autoClose.endTime - Date.now();
  autoClose.remainTime = Math.max(0, Math.ceil(remainMs / 1000));
  if (remainMs <= 0) {
    stopTick();
    if (autoClose.waitSongEnd) {
      // 等本曲播完再停；标记一下，由 onTrackEnded 钩子处理
      pendingPauseOnEnd = true;
    } else {
      player.pause().catch(() => {});
      cancel();
    }
  }
};

/**
 * 启动定时关闭
 * @param durationMin 时长（分钟），>= 1
 * @param waitSongEnd true = 到点等本曲结束再停
 */
export const start = (durationMin: number, waitSongEnd: boolean): void => {
  const status = useStatusStore();
  const safe = Math.max(1, Math.round(durationMin));
  status.autoClose.enable = true;
  status.autoClose.duration = safe;
  status.autoClose.endTime = Date.now() + safe * 60 * 1000;
  status.autoClose.waitSongEnd = waitSongEnd;
  status.autoClose.remainTime = safe * 60;
  pendingPauseOnEnd = false;
  stopTick();
  tickHandle = setInterval(tick, 1000);
};

/** 取消定时关闭，重置状态 */
export const cancel = (): void => {
  const status = useStatusStore();
  status.autoClose.enable = false;
  status.autoClose.endTime = 0;
  status.autoClose.remainTime = 0;
  pendingPauseOnEnd = false;
  stopTick();
};

/**
 * 在 ended 事件钩子里调用：如果开启了"等本曲结束"且时间到了，
 * 此刻把播放停掉并清状态。
 *
 * 返回 true 表示已处理 pause（调用方应跳过自动跳下一首）。
 */
export const onTrackEnded = (): boolean => {
  if (!pendingPauseOnEnd) return false;
  pendingPauseOnEnd = false;
  player.pause().catch(() => {});
  cancel();
  return true;
};
