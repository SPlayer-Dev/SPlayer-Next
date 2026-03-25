import { ipcMain } from "electron";
import { systemLog } from "../utils/logger";

/**
 * 注册系统相关的 IPC 事件
 */
export const registerSystemIpc = (): void => {
  ipcMain.on("ping", () => systemLog.debug("pong"));
};
