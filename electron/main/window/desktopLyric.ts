import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { setTrayDesktopLyric } from "@main/services/tray";
import { store } from "@main/store";
import { broadcast } from "@main/utils/broadcast";

let desktopLyricWindow: BrowserWindow | null = null;

/** 最小宽度 */
const MIN_WIDTH = 400;
/** 最大宽度 */
const MAX_WIDTH = 10000;
/** 默认高度 */
const FALLBACK_HEIGHT = 200;
/** 默认宽度 */
const FALLBACK_WIDTH = 800;
/** 光标位置轮询间隔（ms） */
const CURSOR_POLL_MS = 150;

/**
 * 权威尺寸缓存
 * 所有 setBounds 写宽高都用它，绝不从 getBounds 读尺寸回写，
 * 避免 Windows 高 DPI 下 DIP↔物理像素有损回环造成尺寸漂移
 */
const cachedSize = { width: 0, height: 0 };

/**
 * 光标位置轮询
 * 用 OS 级 screen.getCursorScreenPoint() 判断鼠标是否在歌词窗口内
 */
let cursorPollTimer: NodeJS.Timeout | null = null;
let lastCursorInside = false;

const isCursorInsideBounds = (): boolean => {
  if (!desktopLyricWindow || desktopLyricWindow.isDestroyed()) return false;
  const cursor = screen.getCursorScreenPoint();
  const b = desktopLyricWindow.getBounds();
  return (
    cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height
  );
};

/** 启动光标位置轮询 */
const startCursorPolling = (): void => {
  if (cursorPollTimer) return;
  lastCursorInside = isCursorInsideBounds();
  // 推一次初始值
  desktopLyricWindow?.webContents.send("desktopLyric:cursorInside", lastCursorInside);
  cursorPollTimer = setInterval(() => {
    if (!desktopLyricWindow || desktopLyricWindow.isDestroyed()) {
      stopCursorPolling();
      return;
    }
    const inside = isCursorInsideBounds();
    if (inside !== lastCursorInside) {
      lastCursorInside = inside;
      desktopLyricWindow.webContents.send("desktopLyric:cursorInside", inside);
    }
  }, CURSOR_POLL_MS);
};

/** 停止光标位置轮询 */
const stopCursorPolling = (): void => {
  if (cursorPollTimer) {
    clearInterval(cursorPollTimer);
    cursorPollTimer = null;
  }
};

/** 保存窗口状态 */
const saveWindowState = (): void => {
  if (!desktopLyricWindow || desktopLyricWindow.isDestroyed()) return;
  const { x, y } = desktopLyricWindow.getBounds();
  store.set("windowStates.desktopLyric", {
    x,
    y,
    width: cachedSize.width,
    height: cachedSize.height,
  });
};

/**
 * 应用锁定状态
 * @param locked 是否锁定
 */
export const applyDesktopLyricLock = (locked: boolean): void => {
  const win = getDesktopLyricWindow();
  if (!win) return;
  win.setIgnoreMouseEvents(locked, { forward: true });
  win.setMovable(!locked);
  win.setResizable(!locked);
};

/**
 * 应用窗口置顶
 * @param alwaysOnTop 是否置顶
 */
export const applyDesktopLyricAlwaysOnTop = (alwaysOnTop: boolean): void => {
  const win = getDesktopLyricWindow();
  if (!win) return;
  win.setAlwaysOnTop(alwaysOnTop, "screen-saver");
};

/** 锁定状态下由渲染端切换鼠标事件穿透 */
export const applyDesktopLyricMouseIgnore = (ignore: boolean): void => {
  const win = getDesktopLyricWindow();
  if (!win) return;
  win.setIgnoreMouseEvents(ignore, { forward: true });
};

/**
 * 移动窗口到指定位置
 * 尺寸始终用权威 cachedSize 写回
 * 开启 limitBounds 时把 x/y clamp 到光标所在显示器的 workArea，避免拖出屏幕 / 被任务栏挡住
 */
export const moveDesktopLyricWindow = (x: number, y: number): void => {
  const win = getDesktopLyricWindow();
  if (!win) return;
  let tx = Math.round(x);
  let ty = Math.round(y);
  if (store.get("desktopLyric").limitBounds) {
    const display = screen.getDisplayMatching({
      x: tx,
      y: ty,
      width: cachedSize.width,
      height: cachedSize.height,
    });
    const wa = display.workArea;
    tx = Math.max(wa.x, Math.min(wa.x + wa.width - cachedSize.width, tx));
    ty = Math.max(wa.y, Math.min(wa.y + wa.height - cachedSize.height, ty));
  }
  win.setBounds({ x: tx, y: ty, width: cachedSize.width, height: cachedSize.height });
};

/** 拖拽结束后保存最终位置 */
export const saveDesktopLyricState = (): void => {
  saveWindowState();
};

/** 锁定窗口高度 */
export const applyDesktopLyricHeight = (height: number): void => {
  const win = getDesktopLyricWindow();
  if (!win) return;
  const h = Math.round(height);
  cachedSize.height = h;
  win.setMinimumSize(MIN_WIDTH, h);
  win.setMaximumSize(MAX_WIDTH, h);
  const { x, y } = win.getBounds();
  win.setBounds({ x, y, width: cachedSize.width, height: h });
};

/** 创建桌面歌词窗口，如果窗口已存在则显示并聚焦 */
export const createDesktopLyricWindow = (): BrowserWindow => {
  if (desktopLyricWindow && !desktopLyricWindow.isDestroyed()) {
    desktopLyricWindow.show();
    desktopLyricWindow.focus();
    return desktopLyricWindow;
  }
  const config = store.get("desktopLyric");
  const saved = store.get("windowStates.desktopLyric");
  const initialHeight = saved.height || FALLBACK_HEIGHT;
  const initialWidth = saved.width || FALLBACK_WIDTH;

  desktopLyricWindow = createWindow({
    width: initialWidth,
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
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      images: false,
      disableDialogs: true,
      zoomFactor: 1.0,
    },
  });

  cachedSize.width = initialWidth;
  cachedSize.height = initialHeight;

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    desktopLyricWindow.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/windows/desktop-lyric/index.html`,
    );
  } else {
    desktopLyricWindow.loadFile(join(__dirname, "../renderer/windows/desktop-lyric/index.html"));
  }

  desktopLyricWindow.webContents.on("did-finish-load", () => {
    desktopLyricWindow?.webContents.setZoomFactor(1.0);
  });

  desktopLyricWindow.once("ready-to-show", () => {
    if (!desktopLyricWindow) return;
    const b = desktopLyricWindow.getBounds();
    cachedSize.width = b.width;
    cachedSize.height = b.height;
    desktopLyricWindow.setAlwaysOnTop(config.alwaysOnTop, "screen-saver");
    startCursorPolling();
  });

  if (config.locked) {
    desktopLyricWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  /** 窗口大小变化事件 */
  desktopLyricWindow.on("resized", () => {
    if (!desktopLyricWindow) return;
    const b = desktopLyricWindow.getBounds();
    cachedSize.width = b.width;
    cachedSize.height = b.height;
    saveWindowState();
  });

  /** 设置托盘图标 */
  setTrayDesktopLyric(true);
  broadcast("desktopLyric:visibilityChange", true);

  /** 窗口关闭事件 */
  desktopLyricWindow.on("closed", () => {
    stopCursorPolling();
    desktopLyricWindow = null;
    setTrayDesktopLyric(false);
    broadcast("desktopLyric:visibilityChange", false);
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
