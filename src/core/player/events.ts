import type { PlayerEvent } from "@shared/types/player";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import * as playback from "@/services/playback";
import * as autoClose from "@/services/autoClose";
import * as abLoop from "@/services/abLoop";
import * as session from "@/services/streaming/session";
import {
  hasReachedSeekTarget,
  isSeeking,
  nextTrack,
  pause,
  play,
  prevTrack,
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
      // Jellyfin/Emby 的 PlayState 暂停/恢复立即上报，让 Now Playing 状态及时刷新
      if (event.data.state === "playing" || event.data.state === "paused") {
        session.notifyStateChanged(event.data.position, event.data.state === "paused");
      }
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
      // 用修正后的位置同步歌词索引，避免与显示进度不一致
      useMediaStore().updateLyricIndex(adjusted);
      // AB 循环：到达 B 点 seek 回 A
      abLoop.checkLoop(adjusted);
      // Jellyfin/Emby 进度心跳；session 内部节流到 10s
      session.notifyProgress(adjusted, !status.isPlaying);
      break;
    }
    case "fftData":
      status.fftData = event.data;
      break;
    case "ended": {
      if (endedGuard) return;
      endedGuard = true;
      try {
        // 定时关闭"等本曲结束"模式
        if (autoClose.onTrackEnded()) break;
        // 单曲循环：seek 回开头继续播放
        if (status.repeatMode === "one") {
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
