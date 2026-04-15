import { ipcMain, shell } from "electron";
import type { LocaleCode } from "@shared/types/settings";
import { setLocale } from "@main/utils/i18n";
import { systemLog } from "@main/utils/logger";
import { refreshTray } from "@main/services/tray";
import { getThumbar } from "@main/services/thumbar";
import { getMainWindow, focusMainWindow } from "@main/window";

/**
 * 注册系统相关的 IPC 事件
 */
export const registerSystemIpc = (): void => {
  ipcMain.on("ping", () => systemLog.debug("pong"));

  // 切换开发者工具
  ipcMain.handle("system:toggleDevTools", () => {
    const win = getMainWindow();
    if (win) {
      const wc = win.webContents;
      wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: "detach" });
    }
  });

  // 在文件管理器中显示文件
  ipcMain.handle("system:showInExplorer", (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  // 切换主进程语言（托盘菜单、缩略图工具栏等）
  ipcMain.on("system:setLocale", (_event, locale: LocaleCode) => {
    if (setLocale(locale)) {
      refreshTray();
      getThumbar()?.refreshLocale();
    }
  });

  // 显示并聚焦主窗口
  ipcMain.handle("system:focusMainWindow", () => focusMainWindow());

  // 在主窗口打开设置弹窗
  ipcMain.handle("system:openSettings", (_event, category?: string, highlight?: string) => {
    focusMainWindow();
    getMainWindow()?.webContents.send("system:openSettings", { category, highlight });
  });
};
