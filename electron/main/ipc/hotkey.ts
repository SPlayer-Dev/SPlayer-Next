/**
 * 快捷键 IPC
 */

import { ipcMain } from "electron";
import {
  getHotkeyConfig,
  setBinding,
  resetBindings,
  setGlobalEnabled,
  probeAccelerator,
  getConflicts,
} from "@main/services/globalHotkey";
import type { HotkeyActionId, HotkeyBinding } from "@shared/types/hotkey";

export const registerHotkeyIpc = (): void => {
  ipcMain.handle("hotkey:getAll", () => getHotkeyConfig());

  ipcMain.handle("hotkey:set", (_event, id: HotkeyActionId, binding: HotkeyBinding) =>
    setBinding(id, binding),
  );

  ipcMain.handle("hotkey:reset", (_event, id?: HotkeyActionId) => resetBindings(id));

  ipcMain.handle("hotkey:setGlobalEnabled", (_event, enabled: boolean) =>
    setGlobalEnabled(enabled),
  );

  ipcMain.handle("hotkey:probe", (_event, accel: string) => probeAccelerator(accel));

  ipcMain.handle("hotkey:getConflicts", () => getConflicts());
};
