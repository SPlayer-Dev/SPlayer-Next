import { ipcMain } from "electron";
import { store } from "@main/store";
import type { ConfigPath } from "@main/store/types";
import {
  enable as enableMedia,
  disable as disableMedia,
  reloadDiscordConfig,
} from "@main/services/media";
import { setNormalizationEnabled } from "@main/services/engine";
import {
  setTaskbarProgress,
  applyDesktopLyricLock,
  applyDesktopLyricAlwaysOnTop,
  applyDynamicIslandAlwaysOnTop,
  applyDynamicIslandSnapCentered,
  applyDynamicIslandNonOcclusive,
} from "@main/window";
import { broadcast } from "@main/utils/broadcast";

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
    case "desktopLyric.locked":
      applyDesktopLyricLock(value as boolean);
      break;
    case "desktopLyric.alwaysOnTop":
      applyDesktopLyricAlwaysOnTop(value as boolean);
      break;
    case "dynamicIsland.alwaysOnTop":
      applyDynamicIslandAlwaysOnTop(value as boolean);
      break;
    case "dynamicIsland.snapCentered":
      applyDynamicIslandSnapCentered(value as boolean);
      break;
    case "dynamicIsland.nonOcclusive":
      applyDynamicIslandNonOcclusive(value as boolean);
      break;
  }
  // 桌面歌词配置变更广播到所有窗口
  if (keyPath.startsWith("desktopLyric.")) {
    broadcast("desktopLyric:configChange", store.get("desktopLyric"));
  }
  // 灵动岛配置变更广播到所有窗口
  if (keyPath.startsWith("dynamicIsland.")) {
    broadcast("dynamicIsland:configChange", store.get("dynamicIsland"));
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
