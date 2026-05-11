import { is } from "@electron-toolkit/utils";
import { app } from "electron";
import path from "node:path";
import { store } from "@main/store";

/**
 * 是否为开发环境
 * @returns boolean
 */
export const isDev = is.dev;

/** 是否为 Windows 系统 */
export const isWin = process.platform === "win32";
/** 是否为 macOS 系统 */
export const isMac = process.platform === "darwin";
/** 是否为 Linux 系统 */
export const isLinux = process.platform === "linux";

/**
 * 软件版本
 * @returns string
 */
export const appVersion = app.getVersion();

/** 应用名称 */
export const appName = app.getName();

/** 默认缓存根目录（区别于 Electron 内置的 Cache/Code Cache） */
export const defaultAppCacheDir = path.join(app.getPath("userData"), "app-cache");

/** 当前生效的缓存根目录：用户在设置中可选自定义路径，未配置时回退默认 */
export const getAppCacheDir = (): string => store.get("cache.dir") || defaultAppCacheDir;

/** 当前生效的封面缩略图目录 */
export const getCoverCacheDir = (): string => path.join(getAppCacheDir(), "covers");

/** 当前生效的歌手头像目录 */
export const getArtistCacheDir = (): string => path.join(getAppCacheDir(), "artists");

/** 当前生效的背景图目录 */
export const getBackgroundsDir = (): string => path.join(getAppCacheDir(), "backgrounds");
