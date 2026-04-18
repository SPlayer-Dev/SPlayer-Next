import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { loadNativeModule } from "@main/utils/nativeLoader";
import { broadcast } from "@main/utils/broadcast";
import { setTrayTaskbarLyric } from "@main/services/tray";
import { store } from "@main/store";
import type { TaskbarLyricPosition } from "@shared/types/settings";
import type {
  JsRect,
  JsTaskbarLayout,
  RegistryWatcher,
  TaskbarService,
  TrayWatcher,
  UiaWatcher,
} from "@splayer/taskbar-lyric";
import { taskbarLog } from "@main/utils/logger";

type TaskbarLyricNative = typeof import("@splayer/taskbar-lyric");

const REG_SUBKEY_EXPLORER_ADVANCED =
  "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";
const REG_SUBKEY_PERSONALIZE =
  "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";

type AnchorSide = "left" | "right";

interface PickedSpace {
  rect: JsRect;
  anchor: AnchorSide;
}

let taskbarLyricWindow: BrowserWindow | null = null;
let nativeModule: TaskbarLyricNative | null = null;
let service: TaskbarService | null = null;
let advancedRegWatcher: RegistryWatcher | null = null;
let themeRegWatcher: RegistryWatcher | null = null;
let uiaWatcher: UiaWatcher | null = null;
let trayWatcher: TrayWatcher | null = null;

/** 传给 Rust 的 lyric_width：Win10 据此从 tasklist 划空间，Win11 忽略 */
const currentWidth = 300;

/**
 * 初始窗口尺寸——故意设大，覆盖任何可能的任务栏宽度/高度。
 * 关键原因：Electron BrowserWindow 在 `transparent:true`+SetParent 到任务栏后，
 * Chromium 视口（layered window 的 compositor surface）不会随 setBounds 扩大，
 * 只会收缩。初始尺寸小于后续 setBounds 目标时，超出初始尺寸的区域像素 alpha=0，
 * 按像素 alpha 命中测试会吞掉鼠标事件——即表现为"只有前面一点点可以操作"。
 * 解决方法：初始尺寸开到足够大，后续 setBounds 只做缩小，视口永远覆盖整个 HWND。
 */
const INITIAL_WIDTH = 3000;
const INITIAL_HEIGHT = 200;

/** 获取任务栏歌词窗口实例（未创建或已销毁时返回 null） */
export const getTaskbarLyricWindow = (): BrowserWindow | null =>
  taskbarLyricWindow && !taskbarLyricWindow.isDestroyed() ? taskbarLyricWindow : null;

/** 根据设置和任务栏对齐方式选择使用哪侧空间以及锚定方向 */
const pickSpace = (layout: JsTaskbarLayout): PickedSpace | null => {
  const position: TaskbarLyricPosition = store.get("taskbarLyric.position") ?? "auto";
  const { left, right } = layout.space;
  const isCentered = layout.extra.isCentered;

  if (position === "left" && left.width > 0) return { rect: left, anchor: "left" };
  if (position === "right" && right.width > 0) return { rect: right, anchor: "right" };

  if (position === "auto") {
    if (isCentered) {
      if (left.width >= right.width) return { rect: left, anchor: "left" };
      return { rect: right, anchor: "right" };
    }
    return right.width > 0 ? { rect: right, anchor: "right" } : { rect: left, anchor: "left" };
  }

  if (right.width > 0) return { rect: right, anchor: "right" };
  if (left.width > 0) return { rect: left, anchor: "left" };
  return null;
};

/** 首次 applyLayout 成功后才 show 窗口——避免初始 3000x200 大窗口闪现 */
let firstLayoutDone = false;

/** Rust 布局回调：把物理像素空间转为 DIP 并 setBounds，首次应用时 show 窗口 */
const applyLayout = (layout: JsTaskbarLayout): void => {
  const win = getTaskbarLyricWindow();
  if (!win) return;

  const picked = pickSpace(layout);
  if (!picked) return;
  const { rect, anchor } = picked;
  if (rect.width <= 0 || rect.height <= 0) return;

  // Rust 返回物理像素，setBounds 用逻辑像素（DIP），需按屏幕 scaleFactor 转换
  const dpi = screen.getPrimaryDisplay().scaleFactor;
  const availX = Math.round(rect.x / dpi);
  const availY = Math.round(rect.y / dpi);
  const availWidth = Math.round(rect.width / dpi);
  const availHeight = Math.round(rect.height / dpi);

  const autoMaxWidth = store.get("taskbarLyric.autoMaxWidth") ?? true;
  const maxWidth = store.get("taskbarLyric.maxWidth") ?? 400;
  const windowWidth = autoMaxWidth ? availWidth : Math.min(maxWidth, availWidth);
  const windowX = anchor === "right" ? availX + availWidth - windowWidth : availX;

  win.setBounds({ x: windowX, y: availY, width: windowWidth, height: availHeight });

  if (!firstLayoutDone) {
    firstLayoutDone = true;
    win.show();
  }

  win.webContents.send("taskbarLyric:layout", {
    isCentered: layout.extra.isCentered,
    systemType: layout.extra.systemType,
    isLight: layout.extra.isLight,
    anchor,
  });
};

/** Watcher 回调——任何任务栏相关变化都回到这里重算布局 */
const onLayoutChange = (): void => {
  service?.update(currentWidth);
};

/** 安全创建原生 watcher，失败只 warn 不中断启动 */
const tryStart = <T>(name: string, factory: () => T): T | null => {
  try {
    return factory();
  } catch (error) {
    taskbarLog.warn(`${name} 启动失败`, error);
    return null;
  }
};

/** 创建任务栏歌词窗口：加载原生模块、嵌入任务栏 HWND 并启动 watcher */
export const createTaskbarLyricWindow = (): BrowserWindow | null => {
  if (process.platform !== "win32") {
    taskbarLog.warn("任务栏歌词仅支持 Windows");
    return null;
  }

  if (taskbarLyricWindow && !taskbarLyricWindow.isDestroyed()) {
    taskbarLyricWindow.show();
    return taskbarLyricWindow;
  }

  if (!nativeModule) {
    nativeModule = loadNativeModule<TaskbarLyricNative>("taskbar-lyric.node", "taskbar-lyric");
    if (!nativeModule) {
      taskbarLog.error("原生模块加载失败");
      return null;
    }
  }

  service = new nativeModule.TaskbarService(applyLayout);

  taskbarLyricWindow = createWindow({
    width: INITIAL_WIDTH,
    height: INITIAL_HEIGHT,
    // 覆盖默认 minWidth/minHeight（800/600），允许 setBounds 缩小到很小
    minWidth: 0,
    minHeight: 0,
    type: "toolbar",
    title: "Taskbar Lyric",
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      disableDialogs: true,
      zoomFactor: 1.0,
    },
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    taskbarLyricWindow.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/windows/taskbar-lyric/index.html`,
    );
  } else {
    taskbarLyricWindow.loadFile(join(__dirname, "../renderer/windows/taskbar-lyric/index.html"));
  }

  taskbarLyricWindow.once("ready-to-show", () => {
    const win = taskbarLyricWindow;
    const svc = service;
    const mod = nativeModule;
    if (!win || !svc || !mod) return;

    // Windows 上 HWND 是 64 位指针（x64），读为 BigInt 再转 number
    const hwndPtr = Number(win.getNativeWindowHandle().readBigUInt64LE(0));
    taskbarLog.info(`嵌入窗口 hwnd=${hwndPtr}`);
    svc.embedWindowByPtr(hwndPtr);
    svc.update(currentWidth);

    advancedRegWatcher = tryStart(
      "RegistryWatcher(Advanced)",
      () => new mod.RegistryWatcher(REG_SUBKEY_EXPLORER_ADVANCED, onLayoutChange),
    );
    themeRegWatcher = tryStart(
      "RegistryWatcher(Personalize)",
      () => new mod.RegistryWatcher(REG_SUBKEY_PERSONALIZE, onLayoutChange),
    );
    uiaWatcher = tryStart("UiaWatcher", () => new mod.UiaWatcher(onLayoutChange));
    trayWatcher = tryStart("TrayWatcher", () => new mod.TrayWatcher(onLayoutChange));
  });

  taskbarLyricWindow.on("closed", () => {
    taskbarLyricWindow = null;
    firstLayoutDone = false;
    cleanupWatchers();
    setTrayTaskbarLyric(false);
    broadcast("taskbarLyric:visibilityChange", false);
  });

  setTrayTaskbarLyric(true);
  broadcast("taskbarLyric:visibilityChange", true);
  return taskbarLyricWindow;
};

/** 停止并清空所有 watcher 与 service */
const cleanupWatchers = (): void => {
  advancedRegWatcher?.stop();
  advancedRegWatcher = null;
  themeRegWatcher?.stop();
  themeRegWatcher = null;
  uiaWatcher?.stop();
  uiaWatcher = null;
  trayWatcher?.stop();
  trayWatcher = null;
  service?.stop();
  service = null;
};

/** 关闭任务栏歌词窗口并清理所有资源 */
export const closeTaskbarLyricWindow = (): void => {
  if (taskbarLyricWindow && !taskbarLyricWindow.isDestroyed()) {
    taskbarLyricWindow.close();
  }
  taskbarLyricWindow = null;
  cleanupWatchers();
  setTrayTaskbarLyric(false);
  broadcast("taskbarLyric:visibilityChange", false);
};

/** 切换任务栏歌词窗口显隐 */
export const toggleTaskbarLyricWindow = (): void => {
  if (taskbarLyricWindow && !taskbarLyricWindow.isDestroyed()) {
    closeTaskbarLyricWindow();
  } else {
    createTaskbarLyricWindow();
  }
};

/** 触发一次布局重算 */
export const applyTaskbarLyricLayout = (): void => {
  service?.update(currentWidth);
};
