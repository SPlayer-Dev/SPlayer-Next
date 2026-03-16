import { app, BrowserWindow, net, protocol } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { createMainWindow } from "../window";
import { registerIpcHandlers } from "../ipc";

/**
 * 初始化应用
 */
export const initApp = (): void => {
  // 注册自定义协议（必须在 app ready 之前调用 registerSchemesAsPrivileged）
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "splayer-file",
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

    // 注册 splayer-file:// 协议，用于 renderer 安全访问本地文件（如封面缓存）
    protocol.handle("splayer-file", (request) => {
      const url = new URL(request.url);
      let filePath = decodeURIComponent(url.pathname);
      // Windows 路径：pathname 以 / 开头如 /C:/path，需去除前导 /
      if (process.platform === "win32" && filePath.startsWith("/")) {
        filePath = filePath.slice(1);
      }
      return net.fetch(`file://${filePath}`);
    });

    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    // 注册 IPC 处理
    registerIpcHandlers();

    // 创建主窗口
    createMainWindow();

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
