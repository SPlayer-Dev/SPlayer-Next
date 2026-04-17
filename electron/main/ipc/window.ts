import { ipcMain } from "electron";
import { store } from "@main/store";
import {
  toggleDesktopLyricWindow,
  closeDesktopLyricWindow,
  getDesktopLyricWindow,
  applyDesktopLyricHeight,
  applyDesktopLyricMouseIgnore,
  moveDesktopLyricWindow,
  saveDesktopLyricState,
  toggleDynamicIslandWindow,
  closeDynamicIslandWindow,
  getDynamicIslandWindow,
  moveDynamicIslandWindow,
  saveDynamicIslandState,
  applyDynamicIslandWidth,
  applyDynamicIslandHeight,
  toggleTaskbarLyricWindow,
  closeTaskbarLyricWindow,
  getTaskbarLyricWindow,
} from "@main/window";

/** 窗口管理 IPC */
export const registerWindowIpc = (): void => {
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

  // 锁定态下切换鼠标穿透
  ipcMain.on("desktopLyric:setMouseIgnore", (_event, ignore: boolean) => {
    applyDesktopLyricMouseIgnore(ignore);
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

  // 灵动岛高度变化
  ipcMain.on("dynamicIsland:setHeight", (_event, height: number) => {
    applyDynamicIslandHeight(height);
  });

  // 灵动岛查询当前吸附模式（HMR 后渲染端主动拉取）
  ipcMain.handle("dynamicIsland:getMode", () => {
    const saved = store.get("windowStates.dynamicIsland");
    return saved.mode === "floating" ? "floating" : "snapped";
  });

  // 切换任务栏歌词窗口
  ipcMain.handle("window:toggleTaskbarLyric", () => toggleTaskbarLyricWindow());

  // 关闭任务栏歌词窗口
  ipcMain.handle("window:closeTaskbarLyric", () => closeTaskbarLyricWindow());

  // 查询任务栏歌词窗口是否打开
  ipcMain.handle("window:isTaskbarLyricOpen", () => !!getTaskbarLyricWindow());
};
