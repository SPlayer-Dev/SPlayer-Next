import { app, dialog, ipcMain } from "electron";
import { store } from "@main/store";
import { isWin } from "@main/utils/config";
import { coreLog } from "@main/utils/logger";
import { setPlayerExpanded } from "@main/utils/powerBlocker";
import {
  toggleDesktopLyricWindow,
  closeDesktopLyricWindow,
  getDesktopLyricWindow,
  applyDesktopLyricHeight,
  applyDesktopLyricUnlockButtonBounds,
  moveDesktopLyricWindow,
  saveDesktopLyricState,
  toggleDynamicIslandWindow,
  closeDynamicIslandWindow,
  getDynamicIslandWindow,
  moveDynamicIslandWindow,
  saveDynamicIslandState,
  applyDynamicIslandWidth,
  applyDynamicIslandHeight,
  applyDynamicIslandShape,
  toggleTaskbarLyricWindow,
  closeTaskbarLyricWindow,
  getTaskbarLyricWindow,
  updateTaskbarLyricContentWidth,
  minimizeMainWindow,
  toggleMaximizeMainWindow,
  isMainWindowMaximized,
  toggleFullscreenMainWindow,
  isMainWindowFullscreen,
  hideMainWindow,
  getMainWindow,
  showReadyMainWindow,
} from "@main/window";

/**
 * 注册窗口管理 IPC
 * @param onStartupComplete - 由应用核心提供的启动完成回调
 */
export const registerWindowIpc = (onStartupComplete: () => void): void => {
  ipcMain.on("window:setPlayerExpanded", (event, expanded: boolean) => {
    if (event.sender !== getMainWindow()?.webContents || typeof expanded !== "boolean") return;
    setPlayerExpanded(expanded);
  });

  ipcMain.handle("window:ready", (event) => {
    if (event.sender !== getMainWindow()?.webContents) throw new Error("窗口来源无效");
    return showReadyMainWindow();
  });

  ipcMain.handle("window:startupComplete", (event) => {
    if (event.sender !== getMainWindow()?.webContents) throw new Error("窗口来源无效");
    onStartupComplete();
  });

  ipcMain.on("window:startupFailed", (event, error: string) => {
    if (event.sender !== getMainWindow()?.webContents) return;
    coreLog.error("渲染进程启动失败", error);
    dialog.showErrorBox(app.getName(), error);
    app.quit();
  });

  // 切换桌面歌词窗口
  ipcMain.handle("window:toggleDesktopLyric", () => toggleDesktopLyricWindow());

  // 关闭桌面歌词窗口
  ipcMain.handle("window:closeDesktopLyric", () => closeDesktopLyricWindow());

  // 查询桌面歌词窗口是否打开
  ipcMain.handle("window:isDesktopLyricOpen", () => !!getDesktopLyricWindow());

  // 锁定桌面歌词窗口高度
  ipcMain.handle("desktopLyric:setHeight", (_event, height: number) => {
    applyDesktopLyricHeight(height);
  });

  // 更新锁定态下唯一可交互的解锁按钮区域
  ipcMain.on("desktopLyric:setUnlockButtonBounds", (_event, bounds) => {
    applyDesktopLyricUnlockButtonBounds(bounds);
  });

  // 拖拽移动；只传位置，尺寸由主进程权威 cachedSize 写回
  ipcMain.on("desktopLyric:move", (_event, x: number, y: number) => {
    moveDesktopLyricWindow(x, y);
  });

  // 拖拽结束后保存最终位置
  ipcMain.on("desktopLyric:saveState", () => {
    saveDesktopLyricState();
  });

  // 切换灵动岛窗口
  ipcMain.handle("window:toggleDynamicIsland", () => toggleDynamicIslandWindow());

  // 关闭灵动岛窗口
  ipcMain.handle("window:closeDynamicIsland", () => closeDynamicIslandWindow());

  // 查询灵动岛窗口是否打开
  ipcMain.handle("window:isDynamicIslandOpen", () => !!getDynamicIslandWindow());

  // 灵动岛拖拽移动
  ipcMain.on("dynamicIsland:move", (_event, x: number, y: number) => {
    moveDynamicIslandWindow(x, y);
  });

  // 灵动岛拖拽结束：主进程判定吸附并持久化
  ipcMain.on("dynamicIsland:saveState", () => {
    saveDynamicIslandState();
  });

  // 灵动岛宽度变化：渲染端上报目标宽度
  ipcMain.on("dynamicIsland:resize", (_event, width: number) => {
    applyDynamicIslandWidth(width);
  });
  ipcMain.on("dynamicIsland:setShape", (_event, width: number | null) => {
    applyDynamicIslandShape(width);
  });

  // 灵动岛高度变化
  ipcMain.on("dynamicIsland:setHeight", (_event, height: number) => {
    applyDynamicIslandHeight(height);
  });

  // 灵动岛查询当前吸附模式
  ipcMain.handle("dynamicIsland:getMode", () => {
    const saved = store.get("windowStates.dynamicIsland");
    return saved.mode === "floating" ? "floating" : "snapped";
  });

  // 任务栏歌词仅在 Windows 注册
  if (isWin) {
    // 切换任务栏歌词窗口
    ipcMain.handle("window:toggleTaskbarLyric", () => toggleTaskbarLyricWindow());
    // 关闭任务栏歌词窗口
    ipcMain.handle("window:closeTaskbarLyric", () => closeTaskbarLyricWindow());
    // 查询任务栏歌词窗口是否打开
    ipcMain.handle("window:isTaskbarLyricOpen", () => !!getTaskbarLyricWindow());
    ipcMain.on("taskbarLyric:setContentWidth", (_event, width: number) => {
      updateTaskbarLyricContentWidth(width);
    });
  } else {
    ipcMain.handle("window:toggleTaskbarLyric", () => false);
    ipcMain.handle("window:closeTaskbarLyric", () => undefined);
    ipcMain.handle("window:isTaskbarLyricOpen", () => false);
  }

  // 主窗口控制
  ipcMain.on("window:minimize", () => minimizeMainWindow());
  ipcMain.on("window:toggleMaximize", () => toggleMaximizeMainWindow());
  ipcMain.handle("window:isMaximized", () => isMainWindowMaximized());
  ipcMain.on("window:toggleFullscreen", () => toggleFullscreenMainWindow());
  ipcMain.handle("window:isFullscreen", () => isMainWindowFullscreen());
  ipcMain.on("window:hide", () => hideMainWindow());
  ipcMain.on("window:quit", () => app.quit());
};
