import { BrowserWindow, BrowserWindowConstructorOptions, nativeTheme } from "electron";
import { join } from "path";
import icon from "../../../public/icons/favicon.png?asset";

/**
 * 获取默认窗口配置
 */
const getDefaultOptions = (): BrowserWindowConstructorOptions => ({
  width: 1280,
  height: 800,
  minWidth: 800,
  minHeight: 600,
  autoHideMenuBar: true,
  backgroundColor: nativeTheme.shouldUseDarkColors ? "#101014" : "#f6f6f6",
  icon,
  webPreferences: {
    preload: join(__dirname, "../preload/index.mjs"),
    sandbox: false,
    // 关闭 WebGL
    webgl: false,
    // 关闭拼写检查
    spellcheck: false,
    // 禁用 Web SQL
    enableWebSQL: false,
    // 开启后台节流
    backgroundThrottling: true,
    // code cache
    v8CacheOptions: "code",
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
