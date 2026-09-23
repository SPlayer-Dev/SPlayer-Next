import { resolve } from "node:path";
import { getMainWindow } from "@main/window";
import { coreLog } from "@main/utils/logger";
import { isAudioFile } from "@shared/utils/audioFile";

/** 冷启动捕获到、但渲染层尚未就绪时暂存的音频文件列表 */
let pendingAudioFiles: string[] = [];
/** 渲染层是否已就绪 */
let rendererReady = false;

/**
 * 从命令行参数中提取所有音频文件路径
 * @param argv - 命令行参数（含 argv[0] 程序名）
 * @returns 提取到的音频绝对路径数组
 */
export const extractAudioFiles = (argv: readonly string[]): string[] => {
  const files: string[] = [];
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg.startsWith("--") || arg.startsWith("-")) continue;
    if (isAudioFile(arg)) {
      files.push(resolve(arg));
    }
  }
  return files;
};

/**
 * 捕获外部音频文件打开请求：渲染层就绪则实时下发，否则暂存待拉取
 * @param filePaths - 音频文件路径列表
 */
export const captureAudioFiles = (filePaths: readonly string[]): void => {
  const valid = filePaths.filter(isAudioFile).map((p) => resolve(p));
  if (valid.length === 0) return;
  const win = getMainWindow();
  if (rendererReady && win) {
    win.webContents.send("system:open-files", valid);
  } else {
    pendingAudioFiles.push(...valid);
  }
  coreLog.info("[externalFile] 捕获打开音频文件", valid);
};

/**
 * 渲染层拉取冷启动暂存的音频文件列表，并标记渲染层已就绪
 * @returns 暂存的音频文件列表（取走即清空）
 */
export const consumePendingAudioFiles = (): string[] => {
  rendererReady = true;
  const files = pendingAudioFiles;
  pendingAudioFiles = [];
  return files;
};
