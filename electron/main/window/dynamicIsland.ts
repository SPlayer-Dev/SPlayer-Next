import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { store } from "@main/store";
import { broadcast } from "@main/utils/broadcast";
import { isMac } from "@main/utils/config";
import { setTrayDynamicIsland } from "@main/services/tray";
import { isAppQuitting } from "@main/utils/lifecycle";
import { DYNAMIC_ISLAND_BASE_HEIGHT } from "@shared/defaults/settings";

let dynamicIslandWindow: BrowserWindow | null = null;

/** 用户实测刘海物理宽度，按显示器 scaleFactor 换算成 Electron DIP */
const NOTCH_PHYSICAL_WIDTH = 358;
/** 用户实测刘海物理高度，按显示器 scaleFactor 换算成 Electron DIP */
const NOTCH_PHYSICAL_HEIGHT = 58;
/** 2x 屏下真实刘海主体逻辑宽度，包含右侧轻微覆盖余量 */
const RETINA_NOTCH_BODY_WIDTH = 181;
/** 两侧仅用于顶部横线圆弧对接的轻微外扩宽度 */
const NOTCH_SIDE_OVERHANG = 5;
/** 2x 屏下灵动岛窗口最小逻辑宽度 */
const RETINA_NOTCH_WIDTH = RETINA_NOTCH_BODY_WIDTH + NOTCH_SIDE_OVERHANG * 2;
/** 2x 屏下 PixPin 给出的真实刘海逻辑高度 */
const RETINA_NOTCH_HEIGHT = 29;
/** 软件黑色区域贴住屏幕顶边，避免和物理刘海之间出现缝隙 */
const NOTCH_TOP_OFFSET = 0;
/** 顶部额外填充：窗口上移到顶边后保持底部视觉位置不抖动 */
const NOTCH_TOP_FILL = 3;
/** 高度安全边界：渲染端上报值受这里 clamp，避免极端值导致窗口异常 */
const MIN_HEIGHT = 14;
/** 高度上限：覆盖 200% 缩放主行（80px）+ 后续双行副行余量，留足安全空间 */
const MAX_HEIGHT = 200;
/** 宽度上限：允许从真实刘海向两侧扩展，但避免长歌词撑成横条 */
const MAX_WIDTH = 620;
/** 宽度相对屏幕上限 */
const MAX_WIDTH_RATIO = 0.55;
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

/** 当前是否启用刘海融合，仅 macOS 生效 */
const isNotchFusionEnabled = (): boolean => isMac && store.get("dynamicIsland").notchFusion;

/** 将任意数字 clamp 到合法高度区间 */
const clampHeight = (h: number): number =>
  Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h)));

/**
 * 计算当前显示器上的刘海逻辑尺寸
 * @param display - 当前窗口所在显示器
 * @returns 刘海宽高与顶部偏移
 */
const getNotchMetrics = (
  display: Electron.Display,
): { width: number; height: number; topOffset: number } => {
  const scaleFactor = Math.max(1, display.scaleFactor || 1);
  if (Math.abs(scaleFactor - 2) < 0.25) {
    return {
      width: RETINA_NOTCH_WIDTH,
      height: RETINA_NOTCH_HEIGHT,
      topOffset: NOTCH_TOP_OFFSET,
    };
  }
  return {
    width: Math.round(NOTCH_PHYSICAL_WIDTH / scaleFactor) + NOTCH_SIDE_OVERHANG * 2,
    height: Math.round(NOTCH_PHYSICAL_HEIGHT / scaleFactor),
    topOffset: NOTCH_TOP_OFFSET,
  };
};

/**
 * 计算宽度安全边界，按当前屏宽限制最大展开尺寸
 * @param display - 当前窗口所在显示器
 * @returns 合法宽度区间
 */
const getWidthLimits = (display: Electron.Display): { min: number; max: number } => {
  if (!isNotchFusionEnabled()) {
    return { min: 1, max: display.workArea.width };
  }
  const notch = getNotchMetrics(display);
  const max = Math.max(
    notch.width,
    Math.min(MAX_WIDTH, Math.floor(display.bounds.width * MAX_WIDTH_RATIO)),
  );
  return { min: notch.width, max };
};

/** 将任意数字 clamp 到合法宽度区间 */
const clampWidth = (width: number, display: Electron.Display): number => {
  const limits = getWidthLimits(display);
  return Math.min(limits.max, Math.max(limits.min, Math.round(width)));
};

/**
 * 计算当前窗口所在屏幕
 * 当前屏：优先取窗口实例所在屏；未创建时退回 saved 锚点所在屏；都没有则主显示器
 * @returns 当前显示器
 */
const getCurrentDisplay = (): Electron.Display => {
  const saved = store.get("windowStates.dynamicIsland");
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    const bounds = dynamicIslandWindow.getBounds();
    return screen.getDisplayNearestPoint({
      x: bounds.x + Math.round(bounds.width / 2),
      y: bounds.y + Math.round(bounds.height / 2),
    });
  }
  if (saved.x !== null && saved.y !== null) {
    return screen.getDisplayNearestPoint({
      x: saved.x,
      y: saved.y + Math.round(cachedSize.height / 2),
    });
  }
  return screen.getPrimaryDisplay();
};

/**
 * 计算吸附位置：默认贴工作区顶部；刘海融合时贴屏幕顶边并强制居中
 * @param display - 当前窗口所在显示器
 * @returns 吸附后的左上角坐标
 */
const computeSnappedPos = (
  display: Electron.Display = getCurrentDisplay(),
): { x: number; y: number } => {
  if (!isNotchFusionEnabled()) {
    const config = store.get("dynamicIsland");
    const saved = store.get("windowStates.dynamicIsland");
    const wa = display.workArea;
    if (config.snapCentered || saved.x === null) {
      return {
        x: wa.x + Math.round((wa.width - cachedSize.width) / 2),
        y: wa.y,
      };
    }
    const savedX = saved.x;
    const leftFromCenter = savedX - Math.round(cachedSize.width / 2);
    return {
      x: Math.max(wa.x, Math.min(wa.x + wa.width - cachedSize.width, leftFromCenter)),
      y: wa.y,
    };
  }

  const bounds = display.bounds;
  const centerX = bounds.x + Math.round(bounds.width / 2);
  const leftFromCenter = centerX - Math.round(cachedSize.width / 2);
  const x = Math.max(
    bounds.x,
    Math.min(bounds.x + bounds.width - cachedSize.width, leftFromCenter),
  );
  return { x, y: bounds.y + NOTCH_TOP_OFFSET };
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

  if (isNotchFusionEnabled()) {
    store.set("windowStates.dynamicIsland", {
      ...saved,
      mode: "snapped",
      x: null,
      y: null,
    });
    const pos = computeSnappedPos();
    win.setBounds({ x: pos.x, y: pos.y, width: cachedSize.width, height: cachedSize.height });
    return;
  }

  if (snapCentered) {
    store.set("windowStates.dynamicIsland", {
      ...saved,
      mode: "snapped",
      x: null,
      y: null,
    });
  } else if (saved.x === null) {
    const bounds = win.getBounds();
    const display = screen.getDisplayNearestPoint({
      x: bounds.x + Math.round(bounds.width / 2),
      y: bounds.y + Math.round(bounds.height / 2),
    });
    // 存中心点 x，与拖拽吸附保持同一语义
    store.set("windowStates.dynamicIsland", {
      ...saved,
      mode: "snapped",
      x: bounds.x + Math.round(bounds.width / 2),
      y: display.workArea.y,
    });
  }
  const pos = computeSnappedPos();
  win.setBounds({ x: pos.x, y: pos.y, width: cachedSize.width, height: cachedSize.height });
};

/**
 * 切换刘海融合后立即重算吸附位置
 * @param enabled - 是否启用刘海融合
 */
export const applyDynamicIslandNotchFusion = (enabled: boolean): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const saved = store.get("windowStates.dynamicIsland");
  if (enabled) {
    store.set("windowStates.dynamicIsland", {
      ...saved,
      mode: "snapped",
      x: null,
      y: null,
    });
  } else if (saved.mode !== "snapped") {
    return;
  }
  const pos = computeSnappedPos();
  win.setBounds({ x: pos.x, y: pos.y, width: cachedSize.width, height: cachedSize.height });
};

/**
 * 应用窗口高度：渲染端上报"基准高度 × 缩放（× 行数）"算出的最终高度
 * 主进程仅做安全 clamp，不再硬编码具体值
 * 吸附态走 computeSnappedPos 贴合真实刘海；浮动态保持当前 x/y
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
 * 上限按当前屏 bounds 裁剪，避免长歌词撑出屏幕
 */
export const applyDynamicIslandWidth = (width: number): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const bounds = win.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2),
  });
  const newWidth = clampWidth(width, display);
  const oldWidth = cachedSize.width;
  cachedSize.width = newWidth;
  const saved = store.get("windowStates.dynamicIsland");
  if (saved.mode === "snapped") {
    const pos = computeSnappedPos(display);
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
  const snapY = isNotchFusionEnabled() ? display.bounds.y + NOTCH_TOP_OFFSET : wa.y;
  ty = Math.max(snapY, Math.min(wa.y + wa.height - cachedSize.height, ty));
  win.setBounds({ x: tx, y: ty, width: cachedSize.width, height: cachedSize.height });
  broadcastMode(ty <= snapY ? "snapped" : "floating");
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
 * 落点 y 距离顶部 < SNAP_THRESHOLD 则吸附
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
  const snapY = isNotchFusionEnabled() ? display.bounds.y + NOTCH_TOP_OFFSET : wa.y;
  if (b.y - snapY <= SNAP_THRESHOLD) {
    const config = store.get("dynamicIsland");
    if (isNotchFusionEnabled() || config.snapCentered) {
      const pos = computeSnappedPos(display);
      win.setBounds({ x: pos.x, y: pos.y, width: cachedSize.width, height: cachedSize.height });
      store.set("windowStates.dynamicIsland", {
        ...store.get("windowStates.dynamicIsland"),
        mode: "snapped",
        x: null,
        y: null,
      });
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
      store.set("windowStates.dynamicIsland", {
        ...store.get("windowStates.dynamicIsland"),
        mode: "snapped",
        x: centerX,
        y: wa.y,
      });
    }
    broadcastMode("snapped");
  } else {
    store.set("windowStates.dynamicIsland", {
      ...store.get("windowStates.dynamicIsland"),
      mode: "floating",
      x: b.x,
      y: b.y,
    });
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
  const fusionEnabled = isNotchFusionEnabled();

  const initialDisplay = fusionEnabled ? screen.getPrimaryDisplay() : getCurrentDisplay();
  const floatingPos =
    !fusionEnabled && saved.mode === "floating" && saved.x !== null && saved.y !== null
      ? { x: saved.x, y: saved.y }
      : null;
  const initialNotch = getNotchMetrics(initialDisplay);
  cachedSize.width = clampWidth(INITIAL_WIDTH, initialDisplay);
  cachedSize.height = clampHeight(
    (floatingPos ? 0 : fusionEnabled ? initialNotch.height + NOTCH_TOP_FILL : 0) +
      DYNAMIC_ISLAND_BASE_HEIGHT * config.scale,
  );

  let initialPos: { x: number; y: number };
  if (floatingPos) {
    // 保存的 floating 位置可能已不在任何屏幕内（拔副屏、改分辨率等），按所在屏 workArea 纠正
    const display = screen.getDisplayNearestPoint({
      x: floatingPos.x + Math.round(cachedSize.width / 2),
      y: floatingPos.y + Math.round(cachedSize.height / 2),
    });
    const wa = display.workArea;
    initialPos = {
      x: Math.max(wa.x, Math.min(wa.x + wa.width - cachedSize.width, floatingPos.x)),
      y: Math.max(wa.y, Math.min(wa.y + wa.height - cachedSize.height, floatingPos.y)),
    };
  } else {
    if (fusionEnabled) {
      store.set("windowStates.dynamicIsland", {
        ...saved,
        mode: "snapped",
        x: null,
        y: null,
      });
    } else if (config.snapCentered && saved.mode !== "snapped") {
      store.set("windowStates.dynamicIsland", {
        ...saved,
        mode: "snapped",
        x: null,
        y: null,
      });
    }
    initialPos = computeSnappedPos(initialDisplay);
  }

  dynamicIslandWindow = createWindow({
    width: cachedSize.width,
    height: cachedSize.height,
    minWidth: 1,
    minHeight: 1,
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
    roundedCorners: false,
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
    dynamicIslandWindow.show();
    dynamicIslandWindow.setAlwaysOnTop(config.alwaysOnTop, "screen-saver");
    if (config.nonOcclusive) {
      dynamicIslandWindow.setIgnoreMouseEvents(true, { forward: true });
      startCursorPolling();
    }
  });

  setTrayDynamicIsland(true);
  broadcast("dynamicIsland:visibilityChange", true);
  store.set("windowStates.dynamicIsland.visible", true);

  dynamicIslandWindow.on("closed", () => {
    stopCursorPolling();
    dynamicIslandWindow = null;
    lastBroadcastMode = null;
    setTrayDynamicIsland(false);
    broadcast("dynamicIsland:visibilityChange", false);
    if (!isAppQuitting()) {
      store.set("windowStates.dynamicIsland.visible", false);
    }
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
