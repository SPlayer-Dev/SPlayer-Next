import fs from "node:fs/promises";
import { dialog, ipcMain } from "electron";
import { store } from "@main/store";
import type { ConfigPath } from "@main/store/types";
import { systemLog } from "@main/utils/logger";
import {
  enable as enableMedia,
  disable as disableMedia,
  reloadDiscordConfig,
} from "@main/services/media";
import {
  setNormalizationEnabled,
  setEqualizerEnabled,
  setEqualizerBands,
  setPreampGain,
} from "@main/services/engine";
import {
  setTaskbarProgress,
  applyDesktopLyricLock,
  applyDesktopLyricAlwaysOnTop,
  applyDynamicIslandAlwaysOnTop,
  applyDynamicIslandSnapCentered,
  applyDynamicIslandNonOcclusive,
  applyTaskbarLyricLayout,
} from "@main/window";
import { broadcast } from "@main/utils/broadcast";
import { isWin } from "@main/utils/config";

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
    case "player.equalizer.enabled":
      setEqualizerEnabled(value as boolean);
      break;
    case "player.equalizer.bands":
      setEqualizerBands(value as number[]);
      break;
    case "player.equalizer.preamp":
      setPreampGain(value as number);
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
    case "taskbarLyric.position":
    case "taskbarLyric.autoMaxWidth":
    case "taskbarLyric.maxWidth":
      if (isWin) applyTaskbarLyricLayout();
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
  // 任务栏歌词配置变更广播到所有窗口（仅 Windows）
  if (isWin && keyPath.startsWith("taskbarLyric.")) {
    broadcast("taskbarLyric:configChange", store.get("taskbarLyric"));
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

  /** 替换整盘配置 */
  ipcMain.handle("config:replaceAll", (_event, payload: unknown) => {
    store.replaceAll(payload);
  });

  /** 备份 */
  ipcMain.handle(
    "config:exportToFile",
    async (
      _event,
      payload: unknown,
    ): Promise<{ ok: boolean; reason?: "canceled" | "writeFailed" }> => {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const result = await dialog.showSaveDialog({
        title: "导出设置备份",
        defaultPath: `splayer-settings-${stamp}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, reason: "canceled" };
      try {
        await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), "utf-8");
        systemLog.info(`[config] settings exported to ${result.filePath}`);
        return { ok: true };
      } catch (err) {
        systemLog.error("[config] exportToFile failed", err);
        return { ok: false, reason: "writeFailed" };
      }
    },
  );

  /** 恢复 */
  ipcMain.handle(
    "config:importFromFile",
    async (): Promise<
      { ok: true; data: unknown } | { ok: false; reason: "canceled" | "readFailed" | "parseFailed" }
    > => {
      const result = await dialog.showOpenDialog({
        title: "选择设置备份文件",
        filters: [{ name: "JSON", extensions: ["json"] }],
        properties: ["openFile"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, reason: "canceled" };
      }
      try {
        const text = await fs.readFile(result.filePaths[0], "utf-8");
        try {
          return { ok: true, data: JSON.parse(text) };
        } catch (err) {
          systemLog.error("[config] importFromFile parse failed", err);
          return { ok: false, reason: "parseFailed" };
        }
      } catch (err) {
        systemLog.error("[config] importFromFile read failed", err);
        return { ok: false, reason: "readFailed" };
      }
    },
  );
};
