import { BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import { join } from "path";
import icon from "../../../resources/icon.png?asset";

/**
 * 获取默认窗口配置
 */
const getDefaultOptions = (): BrowserWindowConstructorOptions => ({
  width: 900,
  height: 670,
  show: false,
  autoHideMenuBar: true,
  ...(process.platform === "linux" ? { icon } : {}),
  webPreferences: {
    preload: join(__dirname, "../preload/index.js"),
    sandbox: false,
    // 关闭拼写检查
    spellcheck: false,
    // 禁用 Web SQL
    enableWebSQL: false,
    // 开启后台节流
    backgroundThrottling: true,
    // 跳过“热度检查”
    v8CacheOptions: "bypassHeatCheck",
  },
});

/**
 * 通用窗口创建方法，仅负责合并配置并创建 BrowserWindow 实例
 * @param options - 覆盖默认配置的参数
 */
export const createWindow = (options: BrowserWindowConstructorOptions = {}): BrowserWindow => {
  const defaultOptions = getDefaultOptions();

  return new BrowserWindow({
    ...defaultOptions,
    ...options,
    webPreferences: {
      ...defaultOptions.webPreferences,
      ...options.webPreferences,
    },
  });
};
