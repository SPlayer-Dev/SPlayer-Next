import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { store } from "@main/store";
import { broadcast } from "@main/utils/broadcast";
import { setTrayDynamicIsland } from "@main/services/tray";
import { DYNAMIC_ISLAND_BASE_HEIGHT } from "@shared/defaults/settings";

let dynamicIslandWindow: BrowserWindow | null = null;

/** 高度安全边界：渲染端上报值受这里 clamp，避免极端值导致窗口异常 */
const MIN_HEIGHT = 14;
/** 高度上限：覆盖 200% 缩放主行（80px）+ 后续双行副行余量，留足安全空间 */
const MAX_HEIGHT = 200;
/** 吸附判定阈值：拖拽释放时距顶部小于此值则重新吸附 */
const SNAP_THRESHOLD = 8;
/** 初始宽度（渲染端上报实际宽度前的占位） */
const INITIAL_WIDTH = 200;
/** 光标位置轮询间隔（ms） */
const CURSOR_POLL_MS = 150;

/**
 * 权威尺寸缓存
 * 所有 setBounds 写宽高都用它，绝不从 getBounds 读尺寸回写
 * 避免 Windows 高 DPI 下 DIP↔物理像素有损回环造成尺寸漂移
 */
const cachedSize = { width: INITIAL_WIDTH, height: 40 };

/** 将任意数字 clamp 到合法高度区间 */
const clampHeight = (h: number): number =>
  Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h)));

/**
 * 计算吸附位置：贴当前所在屏 workArea 顶部
 * snapCentered=true 时按屏宽居中
 * snapCentered=false 时把 saved.x 当成窗口中心点 x，按 cachedSize.width 反算左上角；
 *   宽度变化时中心点不变，避免长短歌词切换时窗口被 clamp 拉来拉去
 * 当前屏：优先取窗口实例所在屏；未创建时退回 saved 锚点（中心点 + workArea.y）所在屏；都没有则主显示器
 */
const computeSnappedPos = (): { x: number; y: number } => {
  const config = store.get("dynamicIsland");
  const saved = store.get("windowStates.dynamicIsland");
  let display;
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    const bounds = dynamicIslandWindow.getBounds();
    display = screen.getDisplayNearestPoint({
      x: bounds.x + Math.round(bounds.width / 2),
      y: bounds.y + Math.round(bounds.height / 2),
    });
  } else if (saved.x !== null && saved.y !== null) {
    // snapped 非居中：saved.x 已经是中心点；snapped 居中时 saved.x 必然是 null，不会进这个分支
    display = screen.getDisplayNearestPoint({
      x: saved.x,
      y: saved.y + Math.round(cachedSize.height / 2),
    });
  } else {
    display = screen.getPrimaryDisplay();
  }
  const wa = display.workArea;
  let x: number;
  if (config.snapCentered || saved.x === null) {
    x = wa.x + Math.round((wa.width - cachedSize.width) / 2);
  } else {
    const leftFromCenter = saved.x - Math.round(cachedSize.width / 2);
    x = Math.max(wa.x, Math.min(wa.x + wa.width - cachedSize.width, leftFromCenter));
  }
  return { x, y: wa.y };
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
 * 光标位置轮询：用 OS 级 screen.getCursorScreenPoint() 判断鼠标是否在窗口内
 * 不依赖 DOM 鼠标事件，避免 setIgnoreMouseEvents 穿透时事件漏发、opacity=0 不触发 leave 等坑
 */
let cursorPollTimer: NodeJS.Timeout | null = null;
let lastCursorInside = false;

const isCursorInsideBounds = (): boolean => {
  if (!dynamicIslandWindow || dynamicIslandWindow.isDestroyed()) return false;
  const cursor = screen.getCursorScreenPoint();
  const b = dynamicIslandWindow.getBounds();
  return (
    cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height
  );
};

const startCursorPolling = (): void => {
  if (cursorPollTimer) return;
  lastCursorInside = isCursorInsideBounds();
  dynamicIslandWindow?.webContents.send("dynamicIsland:cursorInside", lastCursorInside);
  cursorPollTimer = setInterval(() => {
    if (!dynamicIslandWindow || dynamicIslandWindow.isDestroyed()) {
      stopCursorPolling();
      return;
    }
    const inside = isCursorInsideBounds();
    if (inside !== lastCursorInside) {
      lastCursorInside = inside;
      dynamicIslandWindow.webContents.send("dynamicIsland:cursorInside", inside);
    }
  }, CURSOR_POLL_MS);
};

const stopCursorPolling = (): void => {
  if (cursorPollTimer) {
    clearInterval(cursorPollTimer);
    cursorPollTimer = null;
  }
  // 离开时推一次 false，避免渲染端卡在 inside=true 状态
  if (lastCursorInside) {
    lastCursorInside = false;
    dynamicIslandWindow?.webContents.send("dynamicIsland:cursorInside", false);
  }
};

/**
 * 应用非遮挡模式：开启后鼠标点击穿透窗口，并启动光标位置轮询
 * 渲染端据此在悬停时把内容渐隐为透明
 */
export const applyDynamicIslandNonOcclusive = (enabled: boolean): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  win.setIgnoreMouseEvents(enabled, { forward: true });
  if (enabled) {
    startCursorPolling();
  } else {
    stopCursorPolling();
  }
};

/**
 * 切换"吸附是否居中"配置后，立即重新对齐窗口
 * - 切到居中：清掉 saved.x，重新居中到当前屏
 * - 切到非居中：把当前位置写入 saved，方便下次启动恢复
 */
export const applyDynamicIslandSnapCentered = (snapCentered: boolean): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const saved = store.get("windowStates.dynamicIsland");
  if (saved.mode !== "snapped") return;
  if (snapCentered) {
    store.set("windowStates.dynamicIsland", { mode: "snapped", x: null, y: null });
  } else if (saved.x === null) {
    const bounds = win.getBounds();
    const display = screen.getDisplayNearestPoint({
      x: bounds.x + Math.round(bounds.width / 2),
      y: bounds.y + Math.round(bounds.height / 2),
    });
    // 存中心点 x，与拖拽吸附保持同一语义
    store.set("windowStates.dynamicIsland", {
      mode: "snapped",
      x: bounds.x + Math.round(bounds.width / 2),
      y: display.workArea.y,
    });
  }
  const pos = computeSnappedPos();
  win.setBounds({ x: pos.x, y: pos.y, width: cachedSize.width, height: cachedSize.height });
};

/**
 * 应用窗口高度：渲染端上报"基准高度 × 缩放（× 行数）"算出的最终高度
 * 主进程仅做安全 clamp，不再硬编码具体值
 * 吸附态走 computeSnappedPos 复用居中/保留水平位置策略；浮动态保持当前 x/y
 */
export const applyDynamicIslandHeight = (height: number): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const h = clampHeight(height);
  cachedSize.height = h;
  const saved = store.get("windowStates.dynamicIsland");
  if (saved.mode === "snapped") {
    const pos = computeSnappedPos();
    win.setBounds({ x: pos.x, y: pos.y, width: cachedSize.width, height: h });
  } else {
    const bounds = win.getBounds();
    win.setBounds({ x: bounds.x, y: bounds.y, width: cachedSize.width, height: h });
  }
};

/**
 * 应用窗口宽度：渲染端上报目标宽度后立即 resize
 * snapped 模式重算 x 居中；floating 模式保持中心点不变
 * 上限裁到所在屏 workArea 宽度，避免长歌词撑出屏幕
 */
export const applyDynamicIslandWidth = (width: number): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const bounds = win.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2),
  });
  const maxWidth = display.workArea.width;
  const newWidth = Math.max(1, Math.min(maxWidth, Math.round(width)));
  const oldWidth = cachedSize.width;
  cachedSize.width = newWidth;
  const saved = store.get("windowStates.dynamicIsland");
  if (saved.mode === "snapped") {
    const pos = computeSnappedPos();
    win.setBounds({ x: pos.x, y: pos.y, width: newWidth, height: cachedSize.height });
  } else {
    // 保持中心点不变
    const centerX = bounds.x + Math.round(oldWidth / 2);
    const newX = centerX - Math.round(newWidth / 2);
    win.setBounds({ x: newX, y: bounds.y, width: newWidth, height: cachedSize.height });
  }
};

/**
 * 移动窗口到指定位置
 * 尺寸始终用权威 cachedSize 写回；拖拽过程保持自由移动
 * 仅约束 y 不上下越界，x 允许超出屏幕（迁移到副屏或半隐都可）
 * 过程中根据距顶部距离实时广播视觉 mode，让圆角随拖拽平滑切换
 */
export const moveDynamicIslandWindow = (x: number, y: number): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const tx = Math.round(x);
  let ty = Math.round(y);
  // 用窗口中心点找最近显示器，避免越界后 getDisplayMatching 选错屏
  const display = screen.getDisplayNearestPoint({
    x: tx + Math.round(cachedSize.width / 2),
    y: ty + Math.round(cachedSize.height / 2),
  });
  const wa = display.workArea;
  ty = Math.max(wa.y, Math.min(wa.y + wa.height - cachedSize.height, ty));
  win.setBounds({ x: tx, y: ty, width: cachedSize.width, height: cachedSize.height });
  broadcastMode(ty <= wa.y ? "snapped" : "floating");
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
 * 落点 y 距离工作区顶部 < SNAP_THRESHOLD 则吸附；snapCentered 决定是否归中
 * 否则记录 floating + 当前坐标
 */
export const saveDynamicIslandState = (): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const b = win.getBounds();
  // 用窗口中心点找最近显示器，避免 x 超出屏幕时 getDisplayMatching 选错屏
  const display = screen.getDisplayNearestPoint({
    x: b.x + Math.round(b.width / 2),
    y: b.y + Math.round(b.height / 2),
  });
  const wa = display.workArea;
  if (b.y - wa.y <= SNAP_THRESHOLD) {
    const config = store.get("dynamicIsland");
    if (config.snapCentered) {
      const leftX = wa.x + Math.round((wa.width - cachedSize.width) / 2);
      win.setBounds({ x: leftX, y: wa.y, width: cachedSize.width, height: cachedSize.height });
      store.set("windowStates.dynamicIsland", { mode: "snapped", x: null, y: null });
    } else {
      // 保留拖到的水平位置；存中心点而非左上角，让后续宽度变化围绕中心点对称伸缩
      const clampedLeftX = Math.max(wa.x, Math.min(wa.x + wa.width - cachedSize.width, b.x));
      const centerX = clampedLeftX + Math.round(cachedSize.width / 2);
      win.setBounds({
        x: clampedLeftX,
        y: wa.y,
        width: cachedSize.width,
        height: cachedSize.height,
      });
      store.set("windowStates.dynamicIsland", { mode: "snapped", x: centerX, y: wa.y });
    }
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

  cachedSize.width = INITIAL_WIDTH;
  // 初始高度按基准 × 缩放估算；渲染端起来后会通过 setHeight 上报实际值（含双行等）
  cachedSize.height = clampHeight(DYNAMIC_ISLAND_BASE_HEIGHT * config.scale);

  let initialPos: { x: number; y: number };
  if (saved.mode === "floating" && saved.x !== null && saved.y !== null) {
    // 保存的 floating 位置可能已不在任何屏幕内（拔副屏、改分辨率等），按所在屏 workArea 纠正
    const display = screen.getDisplayNearestPoint({
      x: saved.x + Math.round(cachedSize.width / 2),
      y: saved.y + Math.round(cachedSize.height / 2),
    });
    const wa = display.workArea;
    initialPos = {
      x: Math.max(wa.x, Math.min(wa.x + wa.width - cachedSize.width, saved.x)),
      y: Math.max(wa.y, Math.min(wa.y + wa.height - cachedSize.height, saved.y)),
    };
  } else {
    initialPos = computeSnappedPos();
  }

  dynamicIslandWindow = createWindow({
    width: cachedSize.width,
    height: cachedSize.height,
    x: initialPos.x,
    y: initialPos.y,
    title: "Dynamic Island",
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
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
    if (!dynamicIslandWindow) return;
    dynamicIslandWindow.webContents.setZoomFactor(1.0);
    // 重播 mode，修复 HMR 刷新后 mode 丢失
    const currentSaved = store.get("windowStates.dynamicIsland");
    lastBroadcastMode = null;
    broadcastMode(currentSaved.mode === "floating" ? "floating" : "snapped");
  });

  dynamicIslandWindow.once("ready-to-show", () => {
    if (!dynamicIslandWindow) return;
    dynamicIslandWindow.setAlwaysOnTop(config.alwaysOnTop, "screen-saver");
    if (config.nonOcclusive) {
      dynamicIslandWindow.setIgnoreMouseEvents(true, { forward: true });
      startCursorPolling();
    }
  });

  setTrayDynamicIsland(true);
  broadcast("dynamicIsland:visibilityChange", true);

  dynamicIslandWindow.on("closed", () => {
    stopCursorPolling();
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
