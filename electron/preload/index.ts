import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

// 暴露给渲染进程的自定义 API
const api = {
  player: {
    // 加载音频（本地路径或网络地址）
    load: (source: string) => ipcRenderer.invoke("player:load", source),
    // 恢复播放
    play: () => ipcRenderer.invoke("player:play"),
    // 暂停播放
    pause: () => ipcRenderer.invoke("player:pause"),
    // 停止播放
    stop: () => ipcRenderer.invoke("player:stop"),
    // 跳转到指定位置（毫秒）
    seek: (position: number) => ipcRenderer.invoke("player:seek", position),
    // 设置音量（0.0 ~ 1.0）
    setVolume: (volume: number) => ipcRenderer.invoke("player:setVolume", volume),
    // 获取当前音量
    getVolume: () => ipcRenderer.invoke("player:getVolume"),
    // 设置暂停/恢复时的渐变时长（毫秒），0 表示禁用
    setFadeDuration: (ms: number) => ipcRenderer.invoke("player:setFadeDuration", ms),
    // 获取当前渐变时长（毫秒）
    getFadeDuration: () => ipcRenderer.invoke("player:getFadeDuration"),
    // 获取播放状态快照
    getStatus: () => ipcRenderer.invoke("player:getStatus"),
    // 获取 FFT 频谱数据
    getFftData: () => ipcRenderer.invoke("player:getFftData"),
    // 启用/禁用 FFT 频谱推送
    setFftEnabled: (enabled: boolean) => ipcRenderer.invoke("player:setFftEnabled", enabled),
    // 重建音频输出设备
    reinit: () => ipcRenderer.invoke("player:reinit"),
    // 打开文件选择对话框
    openFile: () => ipcRenderer.invoke("player:openFile"),
    // 订阅主进程推送的播放事件，返回取消订阅函数
    // 清除全部旧监听
    onEvent: (callback: (event: unknown) => void) => {
      ipcRenderer.removeAllListeners("player:event");
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
        callback(data);
      };
      ipcRenderer.on("player:event", handler);
      return () => {
        ipcRenderer.removeListener("player:event", handler);
      };
    },
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}
