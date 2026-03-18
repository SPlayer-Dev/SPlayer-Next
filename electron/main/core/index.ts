import { app, BrowserWindow, net, protocol } from "electron";
import path from "node:path";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { createMainWindow } from "../window";
import { registerIpcHandlers } from "../ipc";
import { mediaService } from "../services/media";

/** 封面缓存目录（供 cover:// 协议解析使用） */
export const coverCacheDir = path.join(app.getPath("userData"), "cover-cache");

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

  // 退出前清理原生模块资源
  app.on("before-quit", () => {
    mediaService.shutdown();
  });
};
