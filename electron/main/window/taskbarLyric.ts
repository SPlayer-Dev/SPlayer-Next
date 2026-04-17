import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { loadNativeModule } from "@main/utils/nativeLoader";
import { broadcast } from "@main/utils/broadcast";
import { setTrayTaskbarLyric } from "@main/services/tray";
import { store } from "@main/store";
import type { TaskbarLyricPosition } from "@shared/types/settings";
import log from "electron-log";

const taskbarLog = log.scope("taskbar-lyric");

let taskbarLyricWindow: BrowserWindow | null = null;

/** 原生模块类型（从 NAPI 自动生成的 index.d.ts 推断） */
interface TaskbarLyricNative {
  TaskbarService: new (callback: (layout: JsTaskbarLayout) => void) => TaskbarServiceInstance;
  RegistryWatcher: new (callback: () => void) => WatcherInstance;
  UiaWatcher: new (callback: () => void) => WatcherInstance;
  TrayWatcher: new (callback: () => void) => WatcherInstance;
}

interface TaskbarServiceInstance {
  embedWindowByPtr(hwndPtr: number): void;
  update(lyricWidth: number): void;
  stop(): void;
}

interface WatcherInstance {
  stop(): void;
}

interface JsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface JsTaskbarLayout {
  space: { left: JsRect; right: JsRect };
  extra: { systemType: string; isCentered: boolean };
}

let nativeModule: TaskbarLyricNative | null = null;
let service: TaskbarServiceInstance | null = null;
let registryWatcher: WatcherInstance | null = null;
let uiaWatcher: WatcherInstance | null = null;
let trayWatcher: WatcherInstance | null = null;

/** 当前歌词显示的期望宽度（像素），用于触发 Rust 侧布局计算 */
const currentWidth = 300;

/** 获取窗口实例 */
export const getTaskbarLyricWindow = (): BrowserWindow | null =>
  taskbarLyricWindow && !taskbarLyricWindow.isDestroyed() ? taskbarLyricWindow : null;

/** 选择锚定模式：left = 空间左边缘，right = 空间右边缘 */
type AnchorSide = "left" | "right";

interface PickedSpace {
  rect: JsRect;
  anchor: AnchorSide;
}

/** 根据设置和任务栏对齐方式选择使用哪侧空间以及锚定方向 */
const pickSpace = (layout: JsTaskbarLayout): PickedSpace | null => {
  const position: TaskbarLyricPosition = store.get("taskbarLyric.position") ?? "auto";
  const { left, right } = layout.space;
  const isCentered = layout.extra.isCentered;

  // left 模式：歌词紧贴内容（widgets/开始按钮）右侧 = 空间左锚定
  if (position === "left" && left.width > 0) return { rect: left, anchor: "left" };
  // right 模式：歌词紧贴托盘左侧 = 空间右锚定
  if (position === "right" && right.width > 0) return { rect: right, anchor: "right" };

  if (position === "auto") {
    if (isCentered) {
      // 居中任务栏：选空间大的一侧，并锚定到靠近边缘的一侧
      if (left.width >= right.width) return { rect: left, anchor: "left" };
      return { rect: right, anchor: "right" };
    }
    // 左对齐任务栏：歌词放右侧空间，锚定右边缘
    return right.width > 0 ? { rect: right, anchor: "right" } : { rect: left, anchor: "left" };
  }

  // 指定侧没空间，按另一侧回退
  if (right.width > 0) return { rect: right, anchor: "right" };
  if (left.width > 0) return { rect: left, anchor: "left" };
  return null;
};

/** 应用布局——将 Rust 返回的坐标设置到窗口 */
const applyLayout = (layout: JsTaskbarLayout): void => {
  const win = getTaskbarLyricWindow();
  if (!win) return;

  const picked = pickSpace(layout);
  if (!picked) return;
  const { rect, anchor } = picked;
  if (rect.width <= 0 || rect.height <= 0) return;

  // Rust 返回物理像素，setBounds 用逻辑像素（DIP），需按屏幕 scaleFactor 转换
  const display = screen.getPrimaryDisplay();
  const dpi = display.scaleFactor;

  // 将可用区域从物理像素转为逻辑像素
  const availWidthLogical = Math.round(rect.width / dpi);
  const availXLogical = Math.round(rect.x / dpi);
  const availYLogical = Math.round(rect.y / dpi);
  const availHeightLogical = Math.round(rect.height / dpi);

  // autoMaxWidth 开启时占满可用空间，关闭时按 maxWidth 限制（永不超出可用空间）
  const autoMaxWidth = store.get("taskbarLyric.autoMaxWidth") ?? true;
  const maxWidth = store.get("taskbarLyric.maxWidth") ?? 400;
  const windowWidth = autoMaxWidth
    ? availWidthLogical
    : Math.min(maxWidth, availWidthLogical);

  // 按 anchor 决定窗口 x：左锚 = 空间左边缘，右锚 = 空间右边缘对齐
  const windowX =
    anchor === "right" ? availXLogical + availWidthLogical - windowWidth : availXLogical;

  win.setBounds({
    x: windowX,
    y: availYLogical,
    width: windowWidth,
    height: availHeightLogical,
  });

  // 通知渲染端布局信息
  win.webContents.send("taskbarLyric:layout", {
    isCentered: layout.extra.isCentered,
    systemType: layout.extra.systemType,
    anchor,
  });
};

/** Watcher 回调——布局变化时重新计算 */
const onLayoutChange = (): void => {
  service?.update(currentWidth);
};

/** 创建任务栏歌词窗口 */
export const createTaskbarLyricWindow = (): BrowserWindow | null => {
  if (process.platform !== "win32") {
    taskbarLog.warn("任务栏歌词仅支持 Windows");
    return null;
  }

  if (taskbarLyricWindow && !taskbarLyricWindow.isDestroyed()) {
    taskbarLyricWindow.show();
    return taskbarLyricWindow;
  }

  // 加载原生模块
  if (!nativeModule) {
    nativeModule = loadNativeModule<TaskbarLyricNative>(
      "taskbar-lyric.node",
      "taskbar-lyric",
    );
    if (!nativeModule) {
      taskbarLog.error("原生模块加载失败");
      return null;
    }
  }

  // 创建 TaskbarService
  service = new nativeModule.TaskbarService(applyLayout);

  // 创建窗口
  taskbarLyricWindow = createWindow({
    width: currentWidth,
    height: 40,
    // 覆盖默认窗口 minWidth/minHeight（800/600），否则 setBounds 会被撑成大窗口
    minWidth: 0,
    minHeight: 0,
    type: "toolbar",
    title: "Taskbar Lyric",
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      disableDialogs: true,
      zoomFactor: 1.0,
    },
  });

  // 加载渲染器
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    taskbarLyricWindow.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/windows/taskbar-lyric/index.html`,
    );
  } else {
    taskbarLyricWindow.loadFile(
      join(__dirname, "../renderer/windows/taskbar-lyric/index.html"),
    );
  }

  // 渲染就绪后嵌入任务栏
  taskbarLyricWindow.once("ready-to-show", () => {
    if (!taskbarLyricWindow || !service) return;

    // 获取窗口原生句柄
    const handleBuffer = taskbarLyricWindow.getNativeWindowHandle();
    // Windows 上 HWND 是 64 位指针（x64），读为 BigInt 再转 number
    const hwndPtr = Number(handleBuffer.readBigUInt64LE(0));

    taskbarLog.info(`嵌入窗口 hwnd=${hwndPtr}`);
    service.embedWindowByPtr(hwndPtr);

    taskbarLyricWindow.show();

    // 初始布局
    service.update(currentWidth);

    // 启动监听器
    try {
      registryWatcher = new nativeModule!.RegistryWatcher(onLayoutChange);
    } catch (error) {
      taskbarLog.warn("RegistryWatcher 启动失败", error);
    }
    try {
      uiaWatcher = new nativeModule!.UiaWatcher(onLayoutChange);
    } catch (error) {
      taskbarLog.warn("UiaWatcher 启动失败", error);
    }
    try {
      trayWatcher = new nativeModule!.TrayWatcher(onLayoutChange);
    } catch (error) {
      taskbarLog.warn("TrayWatcher 启动失败", error);
    }
  });

  taskbarLyricWindow.on("closed", () => {
    taskbarLyricWindow = null;
    cleanupWatchers();
    setTrayTaskbarLyric(false);
    broadcast("taskbarLyric:visibilityChange", false);
  });

  setTrayTaskbarLyric(true);
  broadcast("taskbarLyric:visibilityChange", true);
  return taskbarLyricWindow;
};

/** 关闭所有监听器 */
const cleanupWatchers = (): void => {
  registryWatcher?.stop();
  registryWatcher = null;
  uiaWatcher?.stop();
  uiaWatcher = null;
  trayWatcher?.stop();
  trayWatcher = null;
  service?.stop();
  service = null;
};

/** 关闭任务栏歌词窗口 */
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

/** 触发一次布局重算——配置变更后调用 */
export const applyTaskbarLyricLayout = (): void => {
  service?.update(currentWidth);
};
