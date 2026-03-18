import { app, BrowserWindow, net, protocol } from "electron";
import path from "node:path";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { createMainWindow } from "../window";
import { registerIpcHandlers } from "../ipc";
import { mediaService } from "../services/media";

/** 封面缓存目录（供 cover:// 协议解析使用） */
export const coverCacheDir = path.join(app.getPath("userData"), "cover-cache");

/**
 * 初始化应用
 */
export const initApp = (): void => {
  // 注册自定义协议（必须在 app ready 之前调用 registerSchemesAsPrivileged）
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
    electronApp.setAppUserModelId("com.electron");

    // 注册 cover:// 协议，前端通过 cover://{filename} 访问封面缩略图
    protocol.handle("cover", (request) => {
      const filename = decodeURIComponent(request.url.slice("cover://".length));
      const filePath = path.join(coverCacheDir, filename);
      return net.fetch(`file://${filePath.replace(/\\/g, "/")}`);
    });

    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    // 注册 IPC
    registerIpcHandlers();

    // 创建主窗口
    createMainWindow();

    // 加载 native 模块
    setImmediate(() => {
      mediaService.init();
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
};
