import { store } from "@main/store";
import { isWin } from "@main/utils/config";
import { createDesktopLyricWindow } from "./desktopLyric";
import { createDynamicIslandWindow } from "./dynamicIsland";
import { createTaskbarLyricWindow } from "./taskbarLyric";

export { createWindow } from "./create";
export {
  createMainWindow,
  getMainWindow,
  focusMainWindow,
  setTaskbarProgress,
  minimizeMainWindow,
  toggleMaximizeMainWindow,
  isMainWindowMaximized,
  toggleFullscreenMainWindow,
  isMainWindowFullscreen,
  hideMainWindow,
} from "./main";
export {
  createDesktopLyricWindow,
  closeDesktopLyricWindow,
  toggleDesktopLyricWindow,
  getDesktopLyricWindow,
  applyDesktopLyricLock,
  applyDesktopLyricAlwaysOnTop,
  applyDesktopLyricMouseIgnore,
  applyDesktopLyricHeight,
  moveDesktopLyricWindow,
  saveDesktopLyricState,
} from "./desktopLyric";
export {
  createDynamicIslandWindow,
  closeDynamicIslandWindow,
  toggleDynamicIslandWindow,
  getDynamicIslandWindow,
  applyDynamicIslandAlwaysOnTop,
  applyDynamicIslandHeight,
  applyDynamicIslandWidth,
  applyDynamicIslandSnapCentered,
  applyDynamicIslandNonOcclusive,
  moveDynamicIslandWindow,
  saveDynamicIslandState,
} from "./dynamicIsland";
export {
  createTaskbarLyricWindow,
  closeTaskbarLyricWindow,
  toggleTaskbarLyricWindow,
  getTaskbarLyricWindow,
  applyTaskbarLyricLayout,
} from "./taskbarLyric";

/** 恢复歌词相关窗口 */
export const restoreLyricWindows = (): void => {
  if (store.get("windowStates.desktopLyric.visible")) createDesktopLyricWindow();
  if (store.get("windowStates.dynamicIsland.visible")) createDynamicIslandWindow();
  if (isWin && store.get("windowStates.taskbarLyric.visible")) {
    createTaskbarLyricWindow();
  }
};
