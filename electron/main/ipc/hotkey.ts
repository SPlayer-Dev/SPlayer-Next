import { ipcMain } from "electron";
import {
  getHotkeyConfig,
  setBinding,
  resetBindings,
  setGlobalEnabled,
  probeAccelerator,
  getConflicts,
  setRecording,
} from "@main/services/globalHotkey";
import type { HotkeyActionId, HotkeyBinding } from "@shared/types/hotkey";

/** 快捷键 IPC */
export const registerHotkeyIpc = (): void => {
  // 拉取完整绑定配置
  ipcMain.handle("hotkey:getAll", () => getHotkeyConfig());

  // 更新单个动作的绑定，并同步重注册全局快捷键
  ipcMain.handle("hotkey:set", (_event, id: HotkeyActionId, binding: HotkeyBinding) =>
    setBinding(id, binding),
  );

  // 重置单项或全部绑定
  ipcMain.handle("hotkey:reset", (_event, id?: HotkeyActionId) => resetBindings(id));

  // 切换全局快捷键总开关
  ipcMain.handle("hotkey:setGlobalEnabled", (_event, enabled: boolean) =>
    setGlobalEnabled(enabled),
  );

  // 探测组合键能否在系统层注册
  ipcMain.handle("hotkey:probe", (_event, accel: string) => probeAccelerator(accel));

  // 录入期间暂停/恢复全局注册
  ipcMain.handle("hotkey:setRecording", (_event, recording: boolean) => setRecording(recording));

  // 拉取当前冲突列表
  ipcMain.handle("hotkey:getConflicts", () => getConflicts());
};
