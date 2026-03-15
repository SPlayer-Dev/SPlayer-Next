import { app } from 'electron'
import { createRequire } from 'module'
import path from 'path'

const requireNative = createRequire(import.meta.url)

/**
 * 加载原生 .node 模块
 *
 * - 开发环境：通过 napi-rs 生成的 index.js 自动检测平台加载对应 .node
 *   路径: native/<devDirName>/index.js
 * - 打包环境：直接加载指定的 .node 文件
 *   路径: resources/native/<fileName>
 *
 * @param fileName 打包后的 .node 文件名 (例如: "audio-engine.win32-x64-msvc.node")
 * @param devDirName 开发环境下的目录名 (例如: "audio-engine")，位于项目根目录的 native/ 下
 * @returns 模块导出对象，加载失败返回 null
 */
export function loadNativeModule<T = unknown>(fileName: string, devDirName: string): T | null {
  let nativeModulePath: string

  if (app.isPackaged) {
    nativeModulePath = path.join(process.resourcesPath, 'native', fileName)
  } else {
    // 开发环境使用 napi-rs 生成的 index.js，它会自动检测平台并加载对应 .node
    nativeModulePath = path.join(process.cwd(), 'native', devDirName)
  }

  try {
    return requireNative(nativeModulePath) as T
  } catch (error) {
    console.error(`[NativeLoader] 加载 ${devDirName} 失败 (${nativeModulePath}):`, error)
    return null
  }
}
