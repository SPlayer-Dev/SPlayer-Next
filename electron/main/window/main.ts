import { BrowserWindow, shell } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { initThumbar } from "@main/services/thumbar";
import { initTray } from "@main/services/tray";
import { store } from "@main/store";
import { handleCacheProtocolOnPartition } from "@main/utils/protocol";

/** 主窗口 session */
const MAIN_PARTITION = "persist:main";

let mainWindow: BrowserWindow | null = null;

/**
 * 创建主窗口
 */
export const createMainWindow = (): BrowserWindow => {
  const remember = store.get("system.rememberWindowState") ?? true;
  const saved = remember ? store.get("windowStates.main") : undefined;

  // 注册 cache:// 协议
  handleCacheProtocolOnPartition(MAIN_PARTITION);

  mainWindow = createWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 800,
    ...(saved?.x != null && saved?.y != null ? { x: saved.x, y: saved.y } : {}),
    webPreferences: {
      partition: MAIN_PARTITION,
    },
  });

  // 恢复最大化状态
  if (remember && saved?.maximized) {
    mainWindow.maximize();
  }

  // 初始化托盘
  initTray();

  // 缩略图工具栏
  mainWindow.once("ready-to-show", () => {
    initThumbar(mainWindow!);
  });

  // 保存窗口状态
  const saveWindowState = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!(store.get("system.rememberWindowState") ?? true)) return;
    const maximized = mainWindow.isMaximized();
    const bounds = maximized
      ? (mainWindow.getNormalBounds?.() ?? mainWindow.getBounds())
      : mainWindow.getBounds();
    store.set("windowStates.main", {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
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

/** 显示并聚焦主窗口（最小化时自动恢复） */
export const focusMainWindow = (): void => {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};

/**
 * 更新任务栏播放进度
 * @param progress - 进度 0~1，或 -1 清除
 * @param paused - 是否暂停状态（显示暂停样式）
 */
export const setTaskbarProgress = (progress: number, paused = false): void => {
  const win = getMainWindow();
  if (!win) return;
  if (progress < 0) {
    win.setProgressBar(-1);
  } else {
    win.setProgressBar(progress, { mode: paused ? "paused" : "normal" });
  }
};
