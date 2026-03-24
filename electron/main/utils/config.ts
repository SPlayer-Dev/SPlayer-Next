import { app } from "electron";
import path from "node:path";

/** 应用名称 */
export const appName = app.getName();

/** 封面缓存目录（供 cover:// 协议解析使用） */
export const coverCacheDir = path.join(app.getPath("userData"), "cover-cache");
