import { ipcMain } from "electron";
import {
  toggleDesktopLyricWindow,
  closeDesktopLyricWindow,
  getDesktopLyricWindow,
  applyDesktopLyricHeight,
  applyDesktopLyricMouseIgnore,
  moveDesktopLyricWindow,
  freezeDesktopLyricSize,
  getDesktopLyricBounds,
} from "@main/window";

/** 窗口管理 IPC */
export const registerWindowIpc = (): void => {
  // 切换桌面歌词窗口
  ipcMain.handle("window:toggleDesktopLyric", () => toggleDesktopLyricWindow());

  // 关闭桌面歌词窗口
  ipcMain.handle("window:closeDesktopLyric", () => closeDesktopLyricWindow());

  // 查询桌面歌词窗口是否打开
  ipcMain.handle("window:isDesktopLyricOpen", () => !!getDesktopLyricWindow());

  // 锁定桌面歌词窗口高度（由渲染端依据字号计算后传入）
  ipcMain.handle("desktopLyric:setHeight", (_event, height: number) => {
    applyDesktopLyricHeight(height);
  });

  // 锁定态下由渲染端切换鼠标穿透（悬停解锁按钮暂放开、离开再穿透）
  ipcMain.on("desktopLyric:setMouseIgnore", (_event, ignore: boolean) => {
    applyDesktopLyricMouseIgnore(ignore);
  });

  // 渲染端自定义拖拽移动窗口（传完整 bounds）
  ipcMain.on(
    "desktopLyric:move",
    (_event, x: number, y: number, width: number, height: number) => {
      moveDesktopLyricWindow(x, y, width, height);
    },
  );

  // 拖拽开始 / 结束时钉住 / 释放最大尺寸
  ipcMain.on("desktopLyric:freezeSize", (_event, freeze: boolean) => {
    freezeDesktopLyricSize(freeze);
  });

  // 查询窗口真实 bounds（拖拽起点用）
  ipcMain.handle("desktopLyric:getBounds", () => getDesktopLyricBounds());
};
