import { ipcMain } from "electron";

/**
 * 注册系统相关的 IPC 事件
 */
export const registerSystemIpc = (): void => {
  ipcMain.on("ping", () => console.log("pong"));
};
