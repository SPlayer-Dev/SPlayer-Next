import { is } from "@electron-toolkit/utils";
import { app } from "electron";
import path from "node:path";
import { store } from "@main/store";
import { defaultCacheDir } from "./paths";

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

/** 是否为便携版 */
export const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;

/**
 * 是否为 AppX/MSIX 安装包
 * AppX 应用安装在 WindowsApps 目录下，路径包含该标识
 */
export const isAppX = isWin && process.execPath.includes("WindowsApps");

/**
 * 软件版本
 * @returns string
 */
export const appVersion = app.getVersion();

/** 应用名称 */
export const appName = app.getName();

/** 当前生效的缓存根目录 */
export const getAppCacheDir = (): string => store.get("cache.dir") || defaultCacheDir;

/** 当前生效的封面缩略图目录 */
export const getCoverCacheDir = (): string => path.join(getAppCacheDir(), "covers");

/** 当前生效的歌手头像目录 */
export const getArtistCacheDir = (): string => path.join(getAppCacheDir(), "artists");

/** 当前生效的背景图目录 */
export const getBackgroundsDir = (): string => path.join(getAppCacheDir(), "backgrounds");

/** 当前生效的歌曲缓存目录 */
export const getSongCacheDir = (): string => path.join(getAppCacheDir(), "songs");

/** 当前生效的下载目录（默认：系统音乐目录下的软件名子目录） */
export const getDownloadDir = (): string =>
  store.get("download.dir") || path.join(app.getPath("music"), appName);
