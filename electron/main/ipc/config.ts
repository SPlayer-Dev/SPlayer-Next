import { ipcMain } from "electron";
import { store } from "../store";
import { enable as enableMedia, disable as disableMedia, reloadDiscordConfig } from "../services/media";
/** 配置写入后的副作用：根据 key 触发主进程对应操作 */
const applyConfigChange = (keyPath: string, value: unknown): void => {
  switch (keyPath) {
    case "media.systemMediaControls":
      value ? enableMedia() : disableMedia();
      break;
    case "media.discord.enabled":
    case "media.discord.showWhenPaused":
    case "media.discord.displayMode":
      reloadDiscordConfig();
      break;
  }
};

/** 注册配置相关 IPC */
export const registerConfigIpc = (): void => {
  ipcMain.handle("config:get", (_event, keyPath: string) => store.get(keyPath));
  ipcMain.handle("config:set", (_event, keyPath: string, value: unknown) => {
    store.set(keyPath, value);
    applyConfigChange(keyPath, value);
  });
  ipcMain.handle("config:getAll", () => store.store);
  ipcMain.handle("config:reset", () => store.clear());
};
