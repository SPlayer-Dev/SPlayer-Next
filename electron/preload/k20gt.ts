import { contextBridge, ipcRenderer } from "electron";
import type { K20GTWorkerApi } from "@shared/types/k20gt";

const api: K20GTWorkerApi = {
  /**
   * 上报音箱连接结果
   * @param status - 当前设备状态
   */
  status: (status) => ipcRenderer.send("k20gt:worker-status", status),
  /**
   * 订阅主进程编码的设备报文
   * @param callback - 报文处理函数
   * @returns 解除监听函数
   */
  onReport: (callback) => {
    ipcRenderer.removeAllListeners("k20gt:report");
    const handler = (_event: Electron.IpcRendererEvent, report: Uint8Array): void =>
      callback(report);
    ipcRenderer.on("k20gt:report", handler);
    return () => ipcRenderer.removeListener("k20gt:report", handler);
  },
};

contextBridge.exposeInMainWorld("k20gtWorker", api);
