import { app, BrowserWindow } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import {
  createMainWindow,
  restoreLyricWindows,
  getMainWindow,
  focusMainWindow,
} from "@main/window";
import { isMac } from "@main/utils/config";
import { registerIpcHandlers } from "@main/ipc";
import { init as initMedia, shutdown as shutdownMedia } from "@main/services/media";
import { init as initLastfm } from "@main/services/lastfm";
import { initGlobalHotkey } from "@main/services/globalHotkey";
import { initDatabase, closeDatabase } from "@main/database";
import { init as initSongCache } from "@main/services/songCache";
import { pluginRegistry } from "@main/plugins/registry";
import { registerCacheScheme, handleCacheProtocol } from "@main/utils/protocol";
import { startServer, stopServer } from "@main/server";
import { initUpdater, disposeUpdater } from "@main/services/updater";
import { coreLog, initLogger } from "@main/utils/logger";

/**
 * 配置 Chromium 启动参数以优化内存占用
 */
const configureMemoryOptimizations = (): void => {
  // 禁止预热备用渲染进程
  app.commandLine.appendSwitch("disable-features", "SpareRendererForSitePerProcess");
};

/**
 * 初始化应用
 */
export const initApp = (): void => {
  configureMemoryOptimizations();
  // 初始化日志
  initLogger();
  // 单例锁
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  // 注册缓存协议方案
  registerCacheScheme();
  // 其他初始化
  app.whenReady().then(() => {
    electronApp.setAppUserModelId("com.imsyy.splayer-next");
    // 注册 cache:// 协议处理
    handleCacheProtocol();
    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });
    // 注册 IPC
    registerIpcHandlers();
    // 创建主窗口
    createMainWindow();
    // 初始化数据库
    initDatabase();
    // 启动歌曲缓存
    void initSongCache();
    initMedia();
    // 初始化 Last.fm 集成
    initLastfm();
    // 初始化插件系统
    pluginRegistry.init();
    // 恢复歌词相关窗口
    restoreLyricWindows();
    // 注册全局快捷键
    initGlobalHotkey();
    // 启动外部 API 服务
    void startServer();
    // 初始化自动更新
    initUpdater();
    app.on("activate", () => {
      if (isMac) {
        if (getMainWindow()) focusMainWindow();
        else createMainWindow();
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
    coreLog.info("应用初始化完成");
  });
  // 所有窗口关闭时退出应用
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  // 退出前清理
  app.on("before-quit", () => {
    coreLog.info("应用即将退出，清理资源");
    shutdownMedia();
    closeDatabase();
    void stopServer();
    void pluginRegistry.shutdown();
    disposeUpdater();
  });
};
