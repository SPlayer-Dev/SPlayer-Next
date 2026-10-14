/**
 * 快捷键 IPC
 */

import { ipcMain, type WebContents } from "electron";
import {
  getHotkeyConfig,
  setBinding,
  resetBindings,
  setGlobalEnabled,
  probeAccelerator,
  getConflicts,
  setGlobalHotkeySuspended,
} from "@main/services/globalHotkey";
import type { HotkeyActionId, HotkeyBinding } from "@shared/types/hotkey";

export const registerHotkeyIpc = (): void => {
  let recordingOwner: WebContents | null = null;

  /** 结束录入，并在页面重载、崩溃或退出时恢复全局快捷键。 */
  const releaseRecording = (): void => {
    if (!recordingOwner) return;
    recordingOwner.removeListener("destroyed", releaseRecording);
    recordingOwner.removeListener("render-process-gone", releaseRecording);
    recordingOwner.removeListener("did-start-navigation", releaseRecording);
    recordingOwner = null;
    setGlobalHotkeySuspended(false);
  };

  ipcMain.handle("hotkey:setRecording", (event, recording: boolean) => {
    if (!recording) {
      if (recordingOwner === event.sender) releaseRecording();
      return;
    }
    if (recordingOwner === event.sender) return;
    releaseRecording();
    recordingOwner = event.sender;
    recordingOwner.once("destroyed", releaseRecording);
    recordingOwner.once("render-process-gone", releaseRecording);
    recordingOwner.once("did-start-navigation", releaseRecording);
    setGlobalHotkeySuspended(true);
  });

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
