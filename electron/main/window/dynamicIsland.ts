import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { store } from "@main/store";
import { broadcast } from "@main/utils/broadcast";
import { setTrayDynamicIsland } from "@main/services/tray";

let dynamicIslandWindow: BrowserWindow | null = null;

/** 固定宽度 */
const ISLAND_WIDTH = 400;
/** 高度下限 */
const MIN_HEIGHT = 28;
/** 高度上限 */
const MAX_HEIGHT = 64;
/** 吸附判定阈值：拖拽释放时距顶部小于此值则重新吸附 */
const SNAP_THRESHOLD = 24;

/**
 * 权威尺寸缓存
 * 所有 setBounds 写宽高都用它，绝不从 getBounds 读尺寸回写
 * 避免 Windows 高 DPI 下 DIP↔物理像素有损回环造成尺寸漂移
 */
const cachedSize = { width: ISLAND_WIDTH, height: 40 };

/** 将任意数字 clamp 到合法高度区间 */
const clampHeight = (h: number): number =>
  Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h)));

/** 计算吸附位置：主显示器 workArea 顶部居中 */
const computeSnappedPos = (): { x: number; y: number } => {
  const display = screen.getPrimaryDisplay();
  const wa = display.workArea;
  return {
    x: wa.x + Math.round((wa.width - cachedSize.width) / 2),
    y: wa.y,
  };
};

/**
 * 应用窗口置顶
 * @param alwaysOnTop 是否置顶
 */
export const applyDynamicIslandAlwaysOnTop = (alwaysOnTop: boolean): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  win.setAlwaysOnTop(alwaysOnTop, "screen-saver");
};

/**
 * 应用窗口高度：更新权威缓存 + min/max 约束 + 立即 setBounds
 * 吸附态下保持贴屏幕顶部；浮动态保持当前 x/y
 */
export const applyDynamicIslandHeight = (height: number): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const h = clampHeight(height);
  cachedSize.height = h;
  win.setMinimumSize(cachedSize.width, h);
  win.setMaximumSize(cachedSize.width, h);
  const saved = store.get("windowStates.dynamicIsland");
  const b = win.getBounds();
  const y = saved.mode === "snapped" ? screen.getDisplayMatching(b).workArea.y : b.y;
  win.setBounds({ x: b.x, y, width: cachedSize.width, height: h });
};

/**
 * 移动窗口到指定位置
 * 尺寸始终用权威 cachedSize 写回；拖拽过程保持自由移动（真正吸附在释放时由 saveDynamicIslandState 完成）
 * 过程中根据距顶部距离实时广播视觉 mode，让圆角随拖拽平滑切换
 */
export const moveDynamicIslandWindow = (x: number, y: number): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const tx = Math.round(x);
  const ty = Math.round(y);
  win.setBounds({ x: tx, y: ty, width: cachedSize.width, height: cachedSize.height });
  const display = screen.getDisplayMatching({
    x: tx,
    y: ty,
    width: cachedSize.width,
    height: cachedSize.height,
  });
  broadcastMode(ty - display.workArea.y <= SNAP_THRESHOLD ? "snapped" : "floating");
};

/** 当前广播过的吸附模式，用于跨阈值时去抖 */
let lastBroadcastMode: "snapped" | "floating" | null = null;

/** 广播当前吸附模式；重复状态不重发 */
const broadcastMode = (mode: "snapped" | "floating"): void => {
  if (mode === lastBroadcastMode) return;
  lastBroadcastMode = mode;
  const win = getDynamicIslandWindow();
  win?.webContents.send("dynamicIsland:modeChange", mode);
};

/**
 * 拖拽结束时判定吸附
 * 落点 y 距离工作区顶部 < SNAP_THRESHOLD 则回吸居中并记录 snapped
 * 否则记录 floating + 当前坐标
 */
export const saveDynamicIslandState = (): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const b = win.getBounds();
  const display = screen.getDisplayMatching(b);
  const wa = display.workArea;
  if (b.y - wa.y <= SNAP_THRESHOLD) {
    const pos = computeSnappedPos();
    win.setBounds({ ...pos, width: cachedSize.width, height: cachedSize.height });
    store.set("windowStates.dynamicIsland", { mode: "snapped", x: null, y: null });
    broadcastMode("snapped");
  } else {
    store.set("windowStates.dynamicIsland", { mode: "floating", x: b.x, y: b.y });
    broadcastMode("floating");
  }
};

/** 创建灵动岛窗口，如果窗口已存在则显示并聚焦 */
export const createDynamicIslandWindow = (): BrowserWindow => {
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    dynamicIslandWindow.show();
    dynamicIslandWindow.focus();
    return dynamicIslandWindow;
  }
  const config = store.get("dynamicIsland");
  const saved = store.get("windowStates.dynamicIsland");

  cachedSize.width = ISLAND_WIDTH;
  cachedSize.height = clampHeight(config.height);

  const initialPos =
    saved.mode === "floating" && saved.x !== null && saved.y !== null
      ? { x: saved.x, y: saved.y }
      : computeSnappedPos();

  dynamicIslandWindow = createWindow({
    width: cachedSize.width,
    height: cachedSize.height,
    x: initialPos.x,
    y: initialPos.y,
    minWidth: cachedSize.width,
    maxWidth: cachedSize.width,
    minHeight: cachedSize.height,
    maxHeight: cachedSize.height,
    title: "Dynamic Island",
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      disableDialogs: true,
      zoomFactor: 1.0,
    },
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    dynamicIslandWindow.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/windows/dynamic-island/index.html`,
    );
  } else {
    dynamicIslandWindow.loadFile(join(__dirname, "../renderer/windows/dynamic-island/index.html"));
  }

  dynamicIslandWindow.webContents.on("did-finish-load", () => {
    dynamicIslandWindow?.webContents.setZoomFactor(1.0);
  });

  const initialMode: "snapped" | "floating" = saved.mode === "floating" ? "floating" : "snapped";

  dynamicIslandWindow.once("ready-to-show", () => {
    if (!dynamicIslandWindow) return;
    dynamicIslandWindow.setAlwaysOnTop(config.alwaysOnTop, "screen-saver");
    broadcastMode(initialMode);
  });

  setTrayDynamicIsland(true);
  broadcast("dynamicIsland:visibilityChange", true);

  dynamicIslandWindow.on("closed", () => {
    dynamicIslandWindow = null;
    lastBroadcastMode = null;
    setTrayDynamicIsland(false);
    broadcast("dynamicIsland:visibilityChange", false);
  });

  return dynamicIslandWindow;
};

/** 关闭灵动岛窗口 */
export const closeDynamicIslandWindow = (): void => {
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    dynamicIslandWindow.close();
  }
};

/** 切换灵动岛窗口 */
export const toggleDynamicIslandWindow = (): boolean => {
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    closeDynamicIslandWindow();
    return false;
  }
  createDynamicIslandWindow();
  return true;
};

/** 获取灵动岛窗口实例 */
export const getDynamicIslandWindow = (): BrowserWindow | null => {
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) return dynamicIslandWindow;
  return null;
};
