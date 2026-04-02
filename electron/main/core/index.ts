import { app, BrowserWindow, net, protocol } from "electron";
import path from "node:path";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { createMainWindow } from "../window";
import { registerIpcHandlers } from "../ipc";
import { init as initMedia, shutdown as shutdownMedia } from "../services/media";
import { initDatabase, closeDatabase } from "../services/database";
import { coverCacheDir } from "../utils/config";
import { coreLog, initLogger } from "../utils/logger";

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
    [
      "MediaRouter", // 不需要 Chromecast
      "TranslateUI", // 不需要翻译
      "SpareRendererForSitePerProcess", // 不需要备用渲染进程
    ].join(","),
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
  // 注册自定义协议
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "cover",
      privileges: {
        secure: true,
        supportFetchAPI: true,
        bypassCSP: true,
        stream: true,
      },
    },
  ]);
  app.whenReady().then(() => {
    electronApp.setAppUserModelId("com.imsyy.splayer-next");
    // 注册 cover:// 协议
    protocol.handle("cover", (request) => {
      const filename = decodeURIComponent(request.url.slice("cover://".length));
      const filePath = path.join(coverCacheDir, filename);
      return net.fetch(`file://${filePath.replace(/\\/g, "/")}`);
    });
    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });
    // 初始化数据库
    initDatabase();
    // 注册 IPC
    registerIpcHandlers();
    // 初始化系统媒体控件
    initMedia();
    // 创建主窗口
    createMainWindow();
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
    shutdownMedia();
    closeDatabase();
  });
};;
