import { isWin } from "@main/utils/config";
import { nativeLog } from "@main/utils/logger";
import { loadNativeModule } from "@main/utils/nativeLoader";

/**
 * 前台窗口全屏探测服务
 *
 * 依赖 window-monitor 原生模块（仅 Windows 构建）：读取前台窗口矩形，
 * 判断其是否完整覆盖所在显示器，从而得知"是否有应用正处于全屏"。
 *
 * 灵动岛据此在他人全屏（游戏 / 视频 / 演示 / 浏览器 F11）时隐藏，
 * 退出全屏后恢复，避免常驻 topmost 层级压在全屏内容之上。
 *
 * 非 Windows 平台没有对应实现，查询恒返回 false，即保持"始终显示"的原有行为。
 */

/** 前台全屏轮询间隔（ms）：单次查询只有几个 Win32 调用，开销可忽略，取较短间隔保证切换跟手 */
const POLL_INTERVAL_MS = 300;

type WindowMonitorNative = typeof import("@splayer/window-monitor");

let native: WindowMonitorNative | null = null;
/** 加载失败也标记为已尝试，避免每次轮询都重复 require 触发异常开销 */
let loadAttempted = false;

/** 懒加载原生模块，缺失时静默降级 */
const load = (): WindowMonitorNative | null => {
  if (loadAttempted) return native;
  loadAttempted = true;
  native = loadNativeModule<WindowMonitorNative>("window-monitor.node", "window-monitor");
  return native;
};

/**
 * 查询当前前台窗口是否处于全屏
 * @param excludeHwnd - 需要排除的窗口句柄（自身窗口），避免把自己判定成全屏
 */
export const isForegroundFullscreen = (excludeHwnd: number | null = null): boolean => {
  if (!isWin) return false;
  const mod = load();
  if (!mod) return false;
  try {
    return mod.isForegroundFullscreen(excludeHwnd);
  } catch (error) {
    nativeLog.warn("前台全屏探测失败", error);
    return false;
  }
};

export interface ForegroundFullscreenWatcher {
  /** 最近一次判定结果，供窗口显示前查询，避免全屏时先显示再隐藏造成闪烁 */
  isFullscreen: () => boolean;
  /** 停止轮询 */
  stop: () => void;
}

/**
 * 启动前台全屏轮询，仅在状态变化时回调
 * @param options.getExcludeHwnd - 每次轮询时取需要排除的窗口句柄
 * @param options.onChange - 全屏状态发生变化时触发
 */
export const watchForegroundFullscreen = (options: {
  getExcludeHwnd: () => number | null;
  onChange: (fullscreen: boolean) => void;
}): ForegroundFullscreenWatcher => {
  let last = false;
  let stopped = false;

  const tick = (): void => {
    if (stopped) return;
    // 轮询回调里通常会操作窗口，而窗口可能在两次轮询之间被销毁；
    // 这里兜底避免定时器抛出未捕获异常，也避免状态卡死
    try {
      const current = isForegroundFullscreen(options.getExcludeHwnd());
      if (current === last) return;
      last = current;
      options.onChange(current);
    } catch (error) {
      nativeLog.warn("前台全屏轮询失败", error);
    }
  };

  // 首次判定同步完成且不触发回调，调用方可直接读取 isFullscreen() 决定初始是否显示
  try {
    last = isForegroundFullscreen(options.getExcludeHwnd());
  } catch {
    last = false;
  }
  const timer = setInterval(tick, POLL_INTERVAL_MS);

  return {
    isFullscreen: () => last,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
};
