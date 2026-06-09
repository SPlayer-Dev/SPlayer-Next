/**
 * 渲染端动作注册表
 *
 * 每个 HotkeyActionId 对应一个无参 handler。in-app keydown 命中和 main 进程
 */

import type { HotkeyActionId } from "@shared/types/hotkey";
import { useStatusStore } from "@/stores/status";
import * as player from "@/core/player";

/** 调音量步长 */
const VOLUME_STEP = 0.05;
/** 快进/快退步长（毫秒） */
const SEEK_STEP_MS = 5000;

/**
 * handler 返回值语义：
 * - `true` / `void` / Promise：动作被消费，调用方应 `preventDefault`
 * - `false`：动作未消费（如条件不满足），调用方应让事件继续传播
 */
const handlers = new Map<HotkeyActionId, () => boolean | void | Promise<void>>();

/** 填充 handler 表 */
export const buildRegistry = (): void => {
  handlers.clear();

  // 播放/暂停
  handlers.set("player.togglePlay", () => player.togglePlay());
  // 下一曲
  handlers.set("player.next", () => player.nextTrack(true));
  // 上一曲
  handlers.set("player.prev", () => player.prevTrack());
  // 快进
  handlers.set("player.seekForward", () => {
    const status = useStatusStore();
    const next = Math.min(status.duration, status.position + SEEK_STEP_MS);
    player.seek(next);
  });
  // 快退
  handlers.set("player.seekBack", () => {
    const status = useStatusStore();
    const next = Math.max(0, status.position - SEEK_STEP_MS);
    player.seek(next);
  });
  // 音量增加
  handlers.set("player.volumeUp", () => {
    const status = useStatusStore();
    player.setVolume(Math.min(1, status.volume + VOLUME_STEP));
  });
  // 音量减少
  handlers.set("player.volumeDown", () => {
    const status = useStatusStore();
    player.setVolume(Math.max(0, status.volume - VOLUME_STEP));
  });
  // 循环模式
  handlers.set("player.cycleRepeat", () => player.cycleRepeatMode());
  // 随机模式
  handlers.set("player.toggleShuffle", () => player.toggleShuffleMode());
  // 桌面歌词
  handlers.set("window.toggleDesktopLyric", () => {
    window.api.window.toggleDesktopLyric().catch(() => {});
  });
  // 灵动岛
  handlers.set("window.toggleDynamicIsland", () => {
    window.api.window.toggleDynamicIsland().catch(() => {});
  });
  // 任务栏歌词
  handlers.set("window.toggleTaskbarLyric", () => {
    window.api.window.toggleTaskbarLyric().catch(() => {});
  });
  // 打开播放器
  handlers.set("view.openPlayer", () => {
    useStatusStore().isExpanded = true;
  });
  // 关闭播放器
  handlers.set("view.closePlayer", (): boolean => {
    const status = useStatusStore();
    if (!status.isExpanded) return false;
    status.isExpanded = false;
    return true;
  });
  // 切换播放列表
  handlers.set("view.togglePlaylist", () => {
    const status = useStatusStore();
    if (status.isExpanded) {
      status.fullQueueOpen = !status.fullQueueOpen;
    } else {
      status.outerQueueOpen = !status.outerQueueOpen;
    }
  });
  // 打开搜索
  handlers.set("view.openSearch", () => {
    useStatusStore().searchOpen = true;
  });
};

/**
 * 派发某动作
 * @param id - 动作 ID
 * @returns 是否被消费（false 表示调用方不应 preventDefault）
 */
export const dispatch = (id: HotkeyActionId): boolean => {
  const handler = handlers.get(id);
  if (!handler) return false;
  const result = handler();
  if (result === false) return false;
  return true;
};
