import { BrowserWindow } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { setTrayDesktopLyric } from "@main/services/tray";
import { store } from "@main/store";
import { windowStateStore } from "@main/store/windowStates";

let desktopLyricWindow: BrowserWindow | null = null;

/** 加载桌面歌词独立入口 */
const loadDesktopLyricEntry = (win: BrowserWindow): void => {
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/windows/desktop-lyric/index.html`);
  } else {
    win.loadFile(join(__dirname, "../renderer/windows/desktop-lyric/index.html"));
  }
};

/** 保存窗口几何 */
const saveWindowState = (win: BrowserWindow): void => {
  if (win.isDestroyed()) return;
  const bounds = win.getBounds();
  windowStateStore.set("desktopLyric", {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
  });
};

/**
 * 应用锁定状态：鼠标穿透 + 禁止拖动
 */
export const applyDesktopLyricLock = (locked: boolean): void => {
  const win = getDesktopLyricWindow();
  if (!win) return;
  win.setIgnoreMouseEvents(locked, { forward: true });
  win.setMovable(!locked);
  win.setResizable(!locked);
};

/** 应用置顶状态 */
export const applyDesktopLyricAlwaysOnTop = (alwaysOnTop: boolean): void => {
  const win = getDesktopLyricWindow();
  if (!win) return;
  win.setAlwaysOnTop(alwaysOnTop);
};

/**
 * 创建桌面歌词窗口
 * 使用独立 renderer entry（windows/desktop-lyric/index.html），不挂 router/Pinia/i18n/UI 库
 */
export const createDesktopLyricWindow = (): BrowserWindow => {
  if (desktopLyricWindow && !desktopLyricWindow.isDestroyed()) {
    desktopLyricWindow.show();
    desktopLyricWindow.focus();
    return desktopLyricWindow;
  }
  const config = store.get("desktopLyric");
  const saved = windowStateStore.get("desktopLyric");

  desktopLyricWindow = createWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x !== null && saved.y !== null ? { x: saved.x, y: saved.y } : {}),
    minWidth: 400,
    minHeight: 120,
    title: "Desktop Lyric",
    resizable: !config.locked,
    movable: !config.locked,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    backgroundColor: "#101014",
    webPreferences: {
      images: false,
      disableDialogs: true,
    },
  });
  loadDesktopLyricEntry(desktopLyricWindow);

  if (config.locked) {
    desktopLyricWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  desktopLyricWindow.on("resized", () => saveWindowState(desktopLyricWindow!));
  desktopLyricWindow.on("moved", () => saveWindowState(desktopLyricWindow!));

  setTrayDesktopLyric(true);
  desktopLyricWindow.on("closed", () => {
    desktopLyricWindow = null;
    setTrayDesktopLyric(false);
  });
  return desktopLyricWindow;
};

/** 关闭桌面歌词窗口 */
export const closeDesktopLyricWindow = (): void => {
  if (desktopLyricWindow && !desktopLyricWindow.isDestroyed()) {
    desktopLyricWindow.close();
  }
};

/** 切换桌面歌词窗口 */
export const toggleDesktopLyricWindow = (): boolean => {
  if (desktopLyricWindow && !desktopLyricWindow.isDestroyed()) {
    closeDesktopLyricWindow();
    return false;
  }
  createDesktopLyricWindow();
  return true;
};

/** 获取桌面歌词窗口实例 */
export const getDesktopLyricWindow = (): BrowserWindow | null => {
  if (desktopLyricWindow && !desktopLyricWindow.isDestroyed()) return desktopLyricWindow;
  return null;
};
