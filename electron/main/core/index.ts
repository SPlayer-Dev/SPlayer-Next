import { app, BrowserWindow } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import {
  createMainWindow,
  restoreLyricWindows,
  getDesktopLyricWindow,
  getDynamicIslandWindow,
  getTaskbarLyricWindow,
} from "@main/window";
import { registerIpcHandlers } from "@main/ipc";
import { init as initMedia, shutdown as shutdownMedia } from "@main/services/media";
import { initDatabase, closeDatabase } from "@main/database";
import { pluginRegistry } from "@main/plugins/registry";
import { registerCacheScheme, handleCacheProtocol } from "@main/utils/protocol";
import { coreLog, initLogger } from "@main/utils/logger";
import { store } from "@main/store";
import { isWin } from "@main/utils/config";

/**
 * 配置 Chromium 启动参数以优化内存占用
 */
const configureMemoryOptimizations = (): void => {
  // 限制 JS 堆内存上限
  app.commandLine.appendSwitch("js-flags", "--max-old-space-size=256");
  // 限制 GPU 进程使用的共享内存
  app.commandLine.appendSwitch("gpu-rasterization-msaa-sample-count", "0");
  // 禁用不需要的 Chromium 功能
  app.commandLine.appendSwitch(
    "disable-features",
    ["MediaRouter", "TranslateUI", "SpareRendererForSitePerProcess"].join(","),
  );
  // 减少渲染进程内存分配器保留
  app.commandLine.appendSwitch("renderer-process-limit", "1");
};

/**
 * 初始化应用
 */
export const initApp = (): void => {
  configureMemoryOptimizations();
  // 初始化日志
  initLogger();
  // 单例锁：已有实例时聚焦现有窗口
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

  app.whenReady().then(() => {
    electronApp.setAppUserModelId("com.imsyy.splayer-next");
    // 注册 cache:// 协议处理
    handleCacheProtocol();
    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });
    // 初始化数据库
    initDatabase();
    // 注册 IPC
    registerIpcHandlers();
    // 初始化系统媒体控件
    initMedia();
    // 初始化插件系统（扫描并启动已启用的插件）
    pluginRegistry.init();
    // 创建主窗口
    createMainWindow();
    // 恢复歌词相关窗口
    restoreLyricWindows();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
    coreLog.info("应用初始化完成");
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  // 退出前清理原生模块资源
  app.on("before-quit", () => {
    coreLog.info("应用即将退出，清理资源");
    // 快照歌词相关窗口的打开状态，供下次启动恢复
    store.set("windowStates.desktopLyric.visible", !!getDesktopLyricWindow());
    store.set("windowStates.dynamicIsland.visible", !!getDynamicIslandWindow());
    if (isWin) {
      store.set("windowStates.taskbarLyric.visible", !!getTaskbarLyricWindow());
    }
    shutdownMedia();
    closeDatabase();
    void pluginRegistry.shutdown();
  });
};
