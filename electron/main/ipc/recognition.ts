/**
 * 听歌识曲 IPC：启动 / 取消 / 提交渲染进程 PCM，事件经 recognition:event 广播。
 */

import { ipcMain } from "electron";
import {
  startRecognition,
  cancelRecognition,
  isRecognitionSupported,
  submitPcm,
} from "@main/services/recognition";
import type { RecognitionConfig } from "@shared/types/recognition";

/** 注册听歌识曲 IPC 处理 */
export const registerRecognitionIpc = (): void => {
  ipcMain.handle("recognition:isSupported", () => isRecognitionSupported());
  ipcMain.handle("recognition:start", (_event, config: RecognitionConfig) => {
    startRecognition(config);
    return { success: true };
  });
  ipcMain.handle("recognition:cancel", () => {
    cancelRecognition();
    return { success: true };
  });
  // 渲染进程麦克风（macOS/Linux）路径：结构化克隆传入 8 kHz 单声道 PCM
  ipcMain.handle("recognition:submitPcm", (_event, pcm: Float32Array) => {
    submitPcm(pcm);
    return { success: true };
  });
};
