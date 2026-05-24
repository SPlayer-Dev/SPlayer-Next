import type { PlayerEvent } from "@shared/types/player";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import * as playback from "@/services/playback";
import * as autoClose from "@/services/autoClose";
import * as abLoop from "@/services/abLoop";
import * as cacheScheduler from "@/services/cacheScheduler";
import * as playStats from "./stats";
import {
  hasReachedSeekTarget,
  isSeeking,
  nextTrack,
  pause,
  play,
  prevTrack,
  recoverFromSourceFailure,
  refreshDevices,
  seek,
  setRepeatMode,
  setShuffleMode,
} from "./index";

/** 防止 ended 事件重入 */
let endedGuard = false;

/**
 * 处理主进程推送的播放事件
 * @param event - 播放事件
 */
export const handleEvent = async (event: PlayerEvent): Promise<void> => {
  const status = useStatusStore();
  switch (event.type) {
    case "status":
      // 歌曲加载中或 loading 事件不更新 UI，保持当前封面/进度/播放状态平滑过渡
      if (event.data.state === "loading" || status.trackLoading) break;
      status.state = event.data.state;
      // seek 期间不从 status 事件更新 position，避免回跳；position 更新统一由 position 事件负责
      if (!isSeeking()) {
        status.position = playback.setCurrentTime(event.data.position);
      }
      status.duration = event.data.duration;
      status.volume = event.data.volume;
      playback.setDuration(event.data.duration);
      playback.setPlaying(event.data.state === "playing");
      break;
    case "position": {
      // 歌曲加载中不更新进度
      if (status.trackLoading) break;
      // seek 后丢弃旧位置，直到后端推送的位置到达 seek 目标附近
      if (!hasReachedSeekTarget(event.data.position)) break;
      const adjusted = playback.setCurrentTime(event.data.position);
      status.position = adjusted;
      if (event.data.duration > 0) {
        status.duration = event.data.duration;
        playback.setDuration(event.data.duration);
      }
      // 歌词索引叠加用户设置的偏移；进度条仍走 adjusted 不受影响
      useMediaStore().updateLyricIndex(adjusted + status.lyricOffsetMs);
      // AB 循环：到达 B 点 seek 回 A
      abLoop.checkLoop(adjusted);
      // 推进延时缓存调度
      cacheScheduler.tick(adjusted);
      break;
    }
    case "fftData":
      status.fftData = event.data;
      break;
    case "ended": {
      if (endedGuard) return;
      endedGuard = true;
      try {
        const stopByTimer = autoClose.onTrackEnded();
        // FM 模式跳过
        const repeatOne = status.repeatMode === "one" && !status.fmMode;
        // 结算播放统计
        playStats.onTrackEnded(repeatOne && !stopByTimer);
        // 定时关闭"等本曲结束"模式
        if (stopByTimer) break;
        // 单曲循环：seek 回开头继续播放
        if (repeatOne) {
          await seek(0);
          await play();
        } else {
          await nextTrack();
        }
      } finally {
        endedGuard = false;
      }
      break;
    }
    case "sourceError":
      // 音源失效（网络中断 / URL 过期）
      await recoverFromSourceFailure();
      break;
    case "play":
      await play();
      break;
    case "pause":
      await pause();
      break;
    case "next":
      await nextTrack();
      break;
    case "prev":
      await prevTrack();
      break;
    case "setShuffle":
      setShuffleMode(event.data.mode);
      break;
    case "setRepeat":
      setRepeatMode(event.data.mode);
      break;
    case "deviceChanged":
      refreshDevices();
      break;
  }
};
