import { BrowserWindow } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { setTrayDesktopLyric } from "@main/services/tray";
import { store } from "@main/store";
import { windowStateStore } from "@main/store/windowStates";

let desktopLyricWindow: BrowserWindow | null = null;

/** 最小宽度 */
const MIN_WIDTH = 400;
/** 最大宽度 */
const MAX_WIDTH = 10000;
/** 默认高度 */
const FALLBACK_HEIGHT = 200;

/** 保存窗口几何 */
const saveWindowState = (): void => {
  if (!desktopLyricWindow || desktopLyricWindow.isDestroyed()) return;
  const bounds = desktopLyricWindow.getBounds();
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

/** 锁定状态下由渲染端切换鼠标事件穿透（悬停解锁按钮时临时放开） */
export const applyDesktopLyricMouseIgnore = (ignore: boolean): void => {
  const win = getDesktopLyricWindow();
  if (!win) return;
  win.setIgnoreMouseEvents(ignore, { forward: true });
};

/** 由渲染端自定义拖拽移动窗口（传完整 bounds 规避 Windows DPI 缩放下的重算 bug） */
export const moveDesktopLyricWindow = (
  x: number,
  y: number,
  width: number,
  height: number,
): void => {
  const win = getDesktopLyricWindow();
  if (!win) return;
  win.setBounds({
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  });
};

/**
 * 拖拽期间只钉死 maximumSize 为当前值，避免 DPI 缩放下 Electron 重算放大
 * 不同时设 minimumSize —— min===max 在 DPI 缩放下反而会触发内部尺寸重算导致累积偏移
 */
export const freezeDesktopLyricSize = (freeze: boolean): void => {
  const win = getDesktopLyricWindow();
  if (!win) return;
  const bounds = win.getBounds();
  if (freeze) {
    win.setMaximumSize(bounds.width, bounds.height);
  } else {
    win.setMaximumSize(MAX_WIDTH, bounds.height);
  }
};

/** 读取当前窗口真实 bounds（高 DPI 下 window.screenX/Y 不可靠） */
export const getDesktopLyricBounds = (): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null => {
  const win = getDesktopLyricWindow();
  if (!win) return null;
  const b = win.getBounds();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
};

/**
 * 锁定窗口高度
 * @param height 窗口高度，不能小于最小宽度
 */
export const applyDesktopLyricHeight = (height: number): void => {
  const win = getDesktopLyricWindow();
  if (!win) return;
  win.setMinimumSize(MIN_WIDTH, height);
  win.setMaximumSize(MAX_WIDTH, height);
  const bounds = win.getBounds();
  if (bounds.height !== height) win.setBounds({ ...bounds, height });
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
  const initialHeight = saved.height || FALLBACK_HEIGHT;

  desktopLyricWindow = createWindow({
    width: saved.width,
    height: initialHeight,
    ...(saved.x !== null && saved.y !== null ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: initialHeight,
    maxHeight: initialHeight,
    title: "Desktop Lyric",
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: !config.locked,
    movable: !config.locked,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      images: false,
      disableDialogs: true,
    },
  });
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    desktopLyricWindow.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/windows/desktop-lyric/index.html`,
    );
  } else {
    desktopLyricWindow.loadFile(join(__dirname, "../renderer/windows/desktop-lyric/index.html"));
  }

  if (config.locked) {
    desktopLyricWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  desktopLyricWindow.on("resized", saveWindowState);
  desktopLyricWindow.on("moved", saveWindowState);

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
