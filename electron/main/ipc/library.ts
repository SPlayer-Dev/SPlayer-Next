import { ipcMain, dialog } from "electron";
import { store } from "../store";
import { getAllTracks, searchTracks, getTrackCount, deleteTracksByDir } from "../services/database";
import { startScan, cancelScan, isScanning } from "../services/scanner";
import { libraryLog } from "../utils/logger";
import { ErrorCode } from "@shared/types/errors";

/** 注册音乐库相关 IPC */
export const registerLibraryIpc = (): void => {
  // 开始扫描（全量或增量）
  ipcMain.handle("library:scan", (_event, incremental?: boolean) => {
    try {
      const dirs = store.get("library.scanDirs") as string[];
      if (dirs.length === 0) {
        return { success: false, error: ErrorCode.SCAN_NO_DIRS };
      }
      startScan(dirs, incremental ?? true);
      return { success: true };
    } catch (error) {
      libraryLog.error("启动扫描失败:", error);
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 取消扫描
  ipcMain.handle("library:cancelScan", () => {
    cancelScan();
    return { success: true };
  });

  // 获取全部曲目
  ipcMain.handle("library:getTracks", () => {
    try {
      return { success: true, data: getAllTracks() };
    } catch (error) {
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 搜索曲目
  ipcMain.handle("library:searchTracks", (_event, query: string) => {
    try {
      return { success: true, data: searchTracks(query) };
    } catch (error) {
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 获取曲目总数
  ipcMain.handle("library:getTrackCount", () => {
    try {
      return { success: true, data: getTrackCount() };
    } catch (error) {
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 获取扫描状态
  ipcMain.handle("library:isScanning", () => {
    return { success: true, data: isScanning() };
  });

  // 弹出目录选择器，添加扫描目录
  ipcMain.handle("library:addScanDir", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择音乐文件夹",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: ErrorCode.SCAN_DIR_NOT_SELECTED };
    }
    const dir = result.filePaths[0];
    const dirs = store.get("library.scanDirs") as string[];
    if (dirs.includes(dir)) {
      return { success: false, error: ErrorCode.SCAN_DIR_EXISTS };
    }
    dirs.push(dir);
    store.set("library.scanDirs", dirs);
    libraryLog.info(`添加扫描目录: ${dir}`);
    return { success: true, data: dir };
  });

  // 移除扫描目录及其下所有曲目
  ipcMain.handle("library:removeScanDir", (_event, dir: string) => {
    try {
      const dirs = store.get("library.scanDirs") as string[];
      const idx = dirs.indexOf(dir);
      if (idx === -1) {
        return { success: false, error: ErrorCode.SCAN_DIR_NOT_FOUND };
      }
      dirs.splice(idx, 1);
      store.set("library.scanDirs", dirs);
      deleteTracksByDir(dir);
      libraryLog.info(`移除扫描目录: ${dir}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 获取已配置的扫描目录列表
  ipcMain.handle("library:getScanDirs", () => {
    return { success: true, data: store.get("library.scanDirs") };
  });
};
