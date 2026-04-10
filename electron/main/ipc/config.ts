import { ipcMain } from "electron";
import { store } from "@main/store";
import type { ConfigPath } from "@main/store/types";
import {
  enable as enableMedia,
  disable as disableMedia,
  reloadDiscordConfig,
} from "@main/services/media";
import { setNormalizationEnabled } from "@main/services/engine";
import { setTaskbarProgress } from "@main/window";

/** 配置写入后的副作用 */
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
    case "player.loudnessNormalization":
      setNormalizationEnabled(value as boolean);
      break;
    case "system.taskbarProgress":
      if (!value) setTaskbarProgress(-1);
      break;
  }
};

/** 注册配置相关 IPC */
export const registerConfigIpc = (): void => {
  ipcMain.handle("config:get", (_event, keyPath: string) => store.get(keyPath as ConfigPath));
  ipcMain.handle("config:set", (_event, keyPath: string, value: unknown) => {
    store.set(keyPath, value);
    applyConfigChange(keyPath, value);
  });
  ipcMain.handle("config:getAll", () => store.store);
  ipcMain.handle("config:reset", () => store.clear());
};
