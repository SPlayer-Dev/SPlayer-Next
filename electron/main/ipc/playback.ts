import { ipcMain } from "electron";
import { playbackService } from "../services/playback";
import type { Track } from "@shared/types/player";
import type { RepeatMode, ShuffleMode } from "@shared/types/playback";

/** 注册播放控制相关的 IPC 事件 */
export const registerPlaybackIpc = (): void => {
  // 设置队列并播放
  ipcMain.handle(
    "playback:playFrom",
    async (_event, items: Track[], startIndex?: number) => {
      await playbackService.playFrom(items, startIndex);
    },
  );

  // 下一首
  ipcMain.handle("playback:next", async () => {
    await playbackService.next();
  });

  // 上一首
  ipcMain.handle("playback:prev", async () => {
    await playbackService.prev();
  });

  // 设置循环模式
  ipcMain.handle("playback:setRepeatMode", (_event, mode: RepeatMode) => {
    playbackService.setRepeatMode(mode);
  });

  // 设置随机模式
  ipcMain.handle("playback:setShuffleMode", (_event, mode: ShuffleMode) => {
    playbackService.setShuffleMode(mode);
  });

  // 分页获取队列
  ipcMain.handle("playback:getQueuePage", (_event, offset: number, limit: number) => {
    return playbackService.getQueuePage(offset, limit);
  });

  // 获取队列长度
  ipcMain.handle("playback:getQueueLength", () => {
    return playbackService.getQueueLength();
  });

  // 插入到队列
  ipcMain.handle("playback:insert", (_event, item: Track, afterIndex?: number) => {
    playbackService.insert(item, afterIndex);
  });

  // 从队列移除
  ipcMain.handle("playback:remove", async (_event, index: number) => {
    await playbackService.remove(index);
  });

  // 移动队列项
  ipcMain.handle("playback:move", (_event, fromIndex: number, toIndex: number) => {
    playbackService.move(fromIndex, toIndex);
  });

  // 清空队列
  ipcMain.handle("playback:clear", () => {
    playbackService.clear();
  });
};
