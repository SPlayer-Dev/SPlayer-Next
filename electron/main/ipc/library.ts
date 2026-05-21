import { ipcMain, dialog } from "electron";
import fs from "node:fs/promises";
import { store } from "@main/store";
import {
  getAllTracks,
  searchTracks,
  getTrackCount,
  deleteTracksByDir,
  deleteTracksByPaths,
  getAlbumList,
  getArtistList,
  getAlbumTracks,
  getArtistTracks,
  getTracksByIds,
  getRandomTrack,
  getRandomTracks,
} from "@main/database";
import { startScan, cancelScan, isScanning } from "@main/services/scanner";
import { fetchArtistAvatar, prefetchArtistAvatars } from "@main/apis/musicbrainz";
import { libraryLog } from "@main/utils/logger";
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
    } catch (_error) {
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 获取专辑聚合列表
  ipcMain.handle("library:getAlbums", () => {
    try {
      return { success: true, data: getAlbumList() };
    } catch (_error) {
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 获取歌手聚合列表
  ipcMain.handle("library:getArtists", () => {
    try {
      return { success: true, data: getArtistList() };
    } catch (_error) {
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 获取某专辑下的全部曲目
  ipcMain.handle("library:getAlbumTracks", (_event, albumName: string) => {
    try {
      return { success: true, data: getAlbumTracks(albumName) };
    } catch (_error) {
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 获取某歌手的全部曲目
  ipcMain.handle("library:getArtistTracks", (_event, artistName: string) => {
    try {
      return { success: true, data: getArtistTracks(artistName) };
    } catch (_error) {
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 按 ID 批量获取曲目
  ipcMain.handle("library:getTracksByIds", (_event, ids: string[]) => {
    try {
      return { success: true, data: getTracksByIds(ids) };
    } catch (_error) {
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 搜索曲目
  ipcMain.handle("library:searchTracks", (_event, query: string) => {
    try {
      return { success: true, data: searchTracks(query) };
    } catch (_error) {
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 获取曲目总数
  ipcMain.handle("library:getTrackCount", () => {
    try {
      return { success: true, data: getTrackCount() };
    } catch (_error) {
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 随机取一首曲目
  ipcMain.handle("library:getRandomTrack", () => {
    try {
      return { success: true, data: getRandomTrack() };
    } catch (_error) {
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 随机取多首曲目
  ipcMain.handle("library:getRandomTracks", (_event, limit: number) => {
    try {
      return { success: true, data: getRandomTracks(limit) };
    } catch (_error) {
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
    } catch (_error) {
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 获取已配置的扫描目录列表
  ipcMain.handle("library:getScanDirs", () => {
    return { success: true, data: store.get("library.scanDirs") };
  });

  // 获取歌手头像（MusicBrainz + TheAudioDB）
  ipcMain.handle("library:fetchArtistAvatar", async (_event, artistName: string) => {
    try {
      const url = await fetchArtistAvatar(artistName);
      return { success: true, data: url };
    } catch (error) {
      libraryLog.error(`获取歌手头像失败 [${artistName}]:`, error);
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 预取歌手头像
  ipcMain.handle("library:prefetchArtistAvatars", async (_event, artistNames: string[]) => {
    try {
      if (!Array.isArray(artistNames) || artistNames.length === 0) {
        return { success: true, data: {} };
      }
      const data = await prefetchArtistAvatars(artistNames);
      return { success: true, data };
    } catch (error) {
      libraryLog.error("预取歌手头像失败:", error);
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });

  // 删除曲目文件并从数据库移除
  ipcMain.handle("library:deleteTracks", async (_event, paths: string[]) => {
    try {
      const failed: string[] = [];
      for (const filePath of paths) {
        try {
          await fs.unlink(filePath);
        } catch {
          failed.push(filePath);
        }
      }
      const deleted = paths.filter((p) => !failed.includes(p));
      if (deleted.length > 0) {
        deleteTracksByPaths(deleted);
      }
      libraryLog.info(`删除 ${deleted.length} 个文件，${failed.length} 个失败`);
      return { success: true, data: { deleted: deleted.length, failed: failed.length } };
    } catch (error) {
      libraryLog.error("批量删除文件失败:", error);
      return { success: false, error: ErrorCode.UNKNOWN };
    }
  });
};
