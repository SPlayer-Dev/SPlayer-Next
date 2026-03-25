import { is } from "@electron-toolkit/utils";
import { app } from "electron";
import path from "node:path";

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

/** 封面缓存目录（供 cover:// 协议解析使用） */
export const coverCacheDir = path.join(app.getPath("userData"), "cover-cache");
