import { BrowserWindow, shell } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { initThumbar } from "../services/thumbar";
import { initTray } from "../services/tray";
import { store } from "../store";

let mainWindow: BrowserWindow | null = null;

/**
 * 创建主窗口
 */
export const createMainWindow = (): BrowserWindow => {
  const remember = store.get("system.rememberWindowState") ?? true;
  const saved = remember ? store.get("system.window") : undefined;

  mainWindow = createWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 800,
  });

  // 恢复最大化状态
  if (remember && saved?.maximized) {
    mainWindow.maximize();
  }

  mainWindow.once("ready-to-show", () => {
    initThumbar(mainWindow!);
    initTray(mainWindow!);
  });

  // 保存窗口状态
  const saveWindowState = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!(store.get("system.rememberWindowState") ?? true)) return;
    const maximized = mainWindow.isMaximized();
    const bounds = maximized ? (mainWindow.getNormalBounds?.() ?? mainWindow.getBounds()) : mainWindow.getBounds();
    store.set("system.window", {
      width: bounds.width,
      height: bounds.height,
      maximized,
    });
  };

  mainWindow.on("close", saveWindowState);
  mainWindow.on("maximize", saveWindowState);
  mainWindow.on("unmaximize", saveWindowState);

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // 基于 electron-vite cli 的 HMR
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
};

/**
 * 获取主窗口实例，窗口不存在时返回 null
 */
export const getMainWindow = (): BrowserWindow | null => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  return null;
};
