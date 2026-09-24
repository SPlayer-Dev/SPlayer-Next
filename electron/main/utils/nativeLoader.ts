import { app } from "electron";
import { createRequire } from "module";
import path from "path";
import { nativeLog } from "./logger";
import fs from "node:fs";

const requireNative = createRequire(import.meta.url);

/**
 * 加载一个原生插件
 * @param fileName 编译后的文件名 (例如: "audio-engine.node")
 * @param devDirName 开发环境下的目录名 (例如: "audio-engine")，必须位于项目根目录的 native/ 下
 */
export const loadNativeModule = <T = unknown>(fileName: string, devDirName: string): T | null => {
  if (app.isPackaged) {
    // 打包后: resources/native/audio-engine.node
    const filePath = path.join(process.resourcesPath, "native", fileName);
    if (fs.existsSync(filePath)) {
      return tryLoadNativeModule<T>(filePath, fileName);
    }
    // 根据 app.asar 的相对路径：/path/to/app.asar/../native/audio-engine.node
    const fallbackPath = path.join(path.dirname(app.getAppPath()), "native", fileName);
    if (fs.existsSync(fallbackPath)) {
      return tryLoadNativeModule<T>(fallbackPath, fileName);
    }
    nativeLog.error(
      `在以下路径无法找到 ${fileName}，请确保已正确打包原生插件。`,
      new Set([filePath, fallbackPath]),
    );
    return null;
  } else {
    // 开发时: native/audio-engine/audio-engine.node
    const filePath = path.join(app.getAppPath(), "native", devDirName, fileName);
    return tryLoadNativeModule<T>(filePath, fileName);
  }
};

const tryLoadNativeModule = <T = unknown>(filePath: string, name: string): T | null => {
  try {
    const mod = requireNative(filePath) as T;
    nativeLog.debug(`加载 ${name} 成功`);
    return mod;
  } catch (error) {
    nativeLog.error(`加载 ${name} 失败:`, error);
    return null;
  }
};
