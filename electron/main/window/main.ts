import { app, BrowserWindow, dialog, shell } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { initThumbar } from "@main/services/thumbar";
import { enableTaskbarThumbnail } from "@main/services/thumbnail";
import { initTray } from "@main/services/tray";
import { store } from "@main/store";
import { handleCacheProtocolOnPartition, MAIN_PARTITION } from "@main/utils/protocol";
import { isAppQuitting } from "@main/utils/lifecycle";
import { broadcast } from "@main/utils/broadcast";
import { CURRENT_AGREEMENT_VERSION } from "@shared/constants/agreement";
import { coreLog } from "@main/utils/logger";
import { setMainWindowVisible, setPlayerExpanded } from "@main/utils/powerBlocker";

/** 判断是否应用内部导航 */
const isInternalNavigation = (url: string): boolean => {
  if (url.startsWith("file://")) return true;
  const devBase = process.env["ELECTRON_RENDERER_URL"];
  return !!devBase && url.startsWith(devBase);
};

let mainWindow: BrowserWindow | null = null;
let firstPaint: Promise<void> = Promise.resolve();
let startupShown = false;

/**
 * 创建主窗口
 */
export const createMainWindow = (): BrowserWindow => {
  const remember = store.get("system.rememberWindowState") ?? true;
  /** 旧版窗口状态 */
  const legacyState = remember ? store.get("windowStates.main") : undefined;

  // 注册 cache:// 协议
  handleCacheProtocolOnPartition(MAIN_PARTITION);
  const borderlessWindow = store.get("system.borderlessWindow") ?? true;

  mainWindow = createWindow({
    width: legacyState?.width ?? 1280,
    height: legacyState?.height ?? 800,
    x: legacyState?.x ?? undefined,
    y: legacyState?.y ?? undefined,
    // 位置、尺寸与最大化状态
    ...(remember ? { name: "main-window", windowStatePersistence: true } : {}),
    frame: !borderlessWindow,
    webPreferences: {
      partition: MAIN_PARTITION,
      webgl: true,
      // 首次绘制前不再调用 setZoomFactor，避免 Electron 隐藏窗口的 ready-to-show 回归。
      zoomFactor: Math.max(0.5, Math.min(2, (store.get("system.uiZoom") ?? 100) / 100)),
    },
  });

  startupShown = false;
  firstPaint = new Promise((resolve) => {
    mainWindow!.once("ready-to-show", resolve);
  });

  // 初始化托盘
  initTray();

  // 自定义任务栏缩略图
  enableTaskbarThumbnail(mainWindow);

  // 缩略图工具栏
  mainWindow.once("show", () => {
    initThumbar(mainWindow!);
  });

  mainWindow.on("show", () => setMainWindowVisible(!mainWindow!.isMinimized()));
  mainWindow.on("hide", () => setMainWindowVisible(false));
  mainWindow.on("minimize", () => setMainWindowVisible(false));
  mainWindow.on("restore", () => setMainWindowVisible(mainWindow!.isVisible()));
  mainWindow.webContents.on("render-process-gone", () => setPlayerExpanded(false));
  mainWindow.webContents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) setPlayerExpanded(false);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    if (startupShown) applyMainWindowZoom();
  });

  // 系统级关闭（alt+F4 / 任务栏右键"关闭窗口"）统一隐藏到托盘；
  // 退出由渲染端自定义按钮或托盘"退出"菜单走 app.quit() 触发 isAppQuitting=true 放行
  mainWindow.on("close", (event) => {
    if (isAppQuitting()) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  // 最大化
  mainWindow.on("maximize", () => {
    broadcast("window:maximizeChange", true);
  });
  // 取消最大化
  mainWindow.on("unmaximize", () => {
    broadcast("window:maximizeChange", false);
  });
  // 全屏
  mainWindow.on("enter-full-screen", () => {
    broadcast("window:fullscreenChange", true);
  });
  // 退出全屏
  mainWindow.on("leave-full-screen", () => {
    broadcast("window:fullscreenChange", false);
  });
  // 外链协议白名单
  const openExternalSafe = (url: string): void => {
    if (/^https?:$/i.test(new URL(url).protocol)) {
      void shell.openExternal(url);
    }
  };
  // 设置窗口打开处理程序
  mainWindow.webContents.setWindowOpenHandler((details) => {
    openExternalSafe(details.url);
    return { action: "deny" };
  });
  // 拦截外站顶层导航（如 v-html 内的外链），交系统浏览器打开，防止主窗口被导航走
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isInternalNavigation(url)) return;
    event.preventDefault();
    openExternalSafe(url);
  });

  // 初始地址包含首页 hash，避免路由补写地址时重置 Electron 的缩放。
  let initialHash = "/";
  if (!store.get("system.onboardingCompleted")) {
    initialHash = "/onboarding";
  } else if ((store.get("system.agreedAgreementVersion") as number) < CURRENT_AGREEMENT_VERSION) {
    initialHash = "/agreement-update";
  }

  // 基于 electron-vite cli 的 HMR
  let loading: Promise<void>;
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    const base = process.env["ELECTRON_RENDERER_URL"];
    loading = mainWindow.loadURL(`${base}#${initialHash}`);
  } else {
    loading = mainWindow.loadFile(join(__dirname, "../renderer/index.html"), { hash: initialHash });
  }
  void loading.catch((error) => {
    if (isAppQuitting()) return;
    coreLog.error("主窗口加载失败", error);
    dialog.showErrorBox(app.getName(), String(error));
    app.quit();
  });

  mainWindow.on("closed", () => {
    setMainWindowVisible(false);
    setPlayerExpanded(false);
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

/** 静态启动层首次绘制后显示窗口，页面内部负责与主界面的过渡 */
export const showReadyMainWindow = async (): Promise<void> => {
  const win = getMainWindow();
  if (!win) throw new Error("主窗口不存在");
  await firstPaint;
  if (win.isDestroyed()) throw new Error("主窗口已关闭");
  if (startupShown) return;
  startupShown = true;
  // file:// 导航可能重置构造参数中的缩放，只在首次绘制完成后校正。
  applyMainWindowZoom();
  win.show();
};

/** 显示并聚焦主窗口（最小化时自动恢复） */
export const focusMainWindow = (): void => {
  const win = getMainWindow();
  if (!win || !startupShown) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};

/** 最小化主窗口 */
export const minimizeMainWindow = (): void => {
  getMainWindow()?.minimize();
};

/** 切换最大化 */
export const toggleMaximizeMainWindow = (): void => {
  const win = getMainWindow();
  if (!win) return;
  if (win.isFullScreen()) {
    win.setFullScreen(false);
    if (!win.isMaximized()) win.maximize();
    return;
  }
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
};

/** 查询是否最大化 */
export const isMainWindowMaximized = (): boolean => !!getMainWindow()?.isMaximized();

/** 切换全屏 */
export const toggleFullscreenMainWindow = (): void => {
  const win = getMainWindow();
  if (!win) return;
  win.setFullScreen(!win.isFullScreen());
};

/** 查询是否全屏 */
export const isMainWindowFullscreen = (): boolean => !!getMainWindow()?.isFullScreen();

/** 隐藏主窗口 */
export const hideMainWindow = (): void => {
  getMainWindow()?.hide();
};

/** 应用界面缩放：百分比 → setZoomFactor（clamp 0.5~2.0） */
export const applyMainWindowZoom = (): void => {
  const win = getMainWindow();
  if (!win) return;
  const percent = store.get("system.uiZoom") ?? 100;
  const factor = Math.max(0.5, Math.min(2, percent / 100));
  win.webContents.setZoomFactor(factor);
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
