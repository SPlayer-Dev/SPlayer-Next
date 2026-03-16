import { app } from "electron";
import { createRequire } from "module";
import path from "path";

const requireNative = createRequire(import.meta.url);

/**
 * 加载原生 .node 模块
 *
 * - 开发环境：直接加载 native/<devDirName>/index.node
 * - 打包环境：加载 resources/native/<fileName>
 */
export const loadNativeModule = <T = unknown>(fileName: string, devDirName: string): T | null => {
  const nativeModulePath = app.isPackaged
    ? path.join(process.resourcesPath, "native", fileName)
    : path.join(process.cwd(), "native", devDirName, "index.node");

  try {
    return requireNative(nativeModulePath) as T;
  } catch (error) {
    console.error(`[NativeLoader] 加载 ${devDirName} 失败 (${nativeModulePath}):`, error);
    return null;
  }
};
