import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { loadNativeModule } from "@main/utils/nativeLoader";
import { broadcast } from "@main/utils/broadcast";
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

/** 当前歌词显示的期望宽度（像素） */
let currentWidth = 300;

/** 获取窗口实例 */
export const getTaskbarLyricWindow = (): BrowserWindow | null =>
  taskbarLyricWindow && !taskbarLyricWindow.isDestroyed() ? taskbarLyricWindow : null;

/** 根据位置设置和任务栏对齐方式选择使用哪侧空间 */
const pickSpace = (layout: JsTaskbarLayout): JsRect | null => {
  const position: TaskbarLyricPosition = store.get("taskbarLyric.position") ?? "auto";
  const { left, right } = layout.space;
  const isCentered = layout.extra.isCentered;

  if (position === "left" && left.width > 0) return left;
  if (position === "right" && right.width > 0) return right;

  if (position === "auto") {
    if (isCentered) {
      // 居中任务栏：选空间大的一侧
      return left.width >= right.width ? left : right;
    }
    // 左对齐任务栏：歌词放右侧
    return right.width > 0 ? right : left;
  }

  // 指定侧没空间，回退到有空间的一侧
  return right.width > 0 ? right : left.width > 0 ? left : null;
};

/** 应用布局——将 Rust 返回的坐标设置到窗口 */
const applyLayout = (layout: JsTaskbarLayout): void => {
  const win = getTaskbarLyricWindow();
  if (!win) return;

  const space = pickSpace(layout);
  if (!space || space.width <= 0 || space.height <= 0) return;

  // Rust 返回的是物理像素坐标（相对于任务栏父窗口）
  // setBounds 使用逻辑像素（DIP），需要用屏幕 scaleFactor 转换
  const display = screen.getPrimaryDisplay();
  const dpi = display.scaleFactor;
  win.setBounds({
    x: Math.round(space.x / dpi),
    y: Math.round(space.y / dpi),
    width: Math.round(space.width / dpi),
    height: Math.round(space.height / dpi),
  });

  // 通知渲染端布局信息
  win.webContents.send("taskbarLyric:layout", {
    isCentered: layout.extra.isCentered,
    systemType: layout.extra.systemType,
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
    broadcast("taskbarLyric:visibilityChange", false);
  });

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
