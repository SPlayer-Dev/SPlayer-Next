import { ipcMain } from "electron";
import * as updater from "@main/services/updater";

/** 注册更新相关 IPC */
export const registerUpdateIpc = (): void => {
  ipcMain.handle("update:getState", () => updater.getUpdateState());
  ipcMain.handle("update:check", (_event, manual: boolean) => updater.checkForUpdates(manual));
  ipcMain.handle("update:download", () => updater.downloadUpdate());
  ipcMain.handle("update:install", () => updater.quitAndInstall());
  ipcMain.handle("update:openDownloadPage", () => updater.openDownloadPage());
};
