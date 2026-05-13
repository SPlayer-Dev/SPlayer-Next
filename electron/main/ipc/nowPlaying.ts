import { ipcMain } from "electron";
import { broadcast } from "@main/utils/broadcast";
import * as nowPlaying from "@main/services/nowPlaying";
import type { NowPlayingUpdatePayload } from "@shared/types/nowPlaying";

export const registerNowPlayingIpc = (): void => {
  // 渲染进程同步当前播放状态到主进程
  ipcMain.on("nowPlaying:update", (_event, payload: NowPlayingUpdatePayload) => {
    nowPlaying.update(payload.track, payload.lyric, payload.source);
  });

  // 渲染进程写入指定曲目的歌词偏移
  ipcMain.on("nowPlaying:setLyricOffset", (_event, trackId: string, offsetMs: number) => {
    nowPlaying.setLyricOffset(trackId, offsetMs);
  });

  // 窗口拉取当前完整快照
  ipcMain.handle("nowPlaying:requestSnapshot", () => nowPlaying.snapshot());

  // 订阅 service 事件并广播给所有窗口
  nowPlaying.onTrackChange((data) => broadcast("nowPlaying:track-change", data));
  nowPlaying.onLyricChange((snap) => broadcast("nowPlaying:lyric-change", snap));
  nowPlaying.onPositionSync((data) => broadcast("nowPlaying:position-sync", data));
  nowPlaying.onLyricOffsetChange((data) => broadcast("nowPlaying:lyric-offset-change", data));
};
