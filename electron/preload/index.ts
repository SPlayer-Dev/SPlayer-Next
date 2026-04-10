import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

// 暴露给渲染进程的自定义 API
const api = {
  config: {
    get: (keyPath: string) => ipcRenderer.invoke("config:get", keyPath),
    set: (keyPath: string, value: unknown) => ipcRenderer.invoke("config:set", keyPath, value),
    getAll: () => ipcRenderer.invoke("config:getAll"),
    reset: () => ipcRenderer.invoke("config:reset"),
  },
  player: {
    // 加载音频（本地路径或网络地址）
    load: (source: string, autoPlay = true) => ipcRenderer.invoke("player:load", source, autoPlay),
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
    // 启用/禁用音量均衡
    setNormalizationEnabled: (enabled: boolean) =>
      ipcRenderer.invoke("player:setNormalizationEnabled", enabled),
    // 重建音频输出设备
    reinit: () => ipcRenderer.invoke("player:reinit"),
    // 获取所有音频输出设备
    getOutputDevices: () => ipcRenderer.invoke("player:getOutputDevices"),
    // 获取系统默认输出设备名称
    getDefaultDeviceName: () => ipcRenderer.invoke("player:getDefaultDeviceName"),
    // 切换输出设备（传 null 使用系统默认）
    setOutputDevice: (deviceName: string | null) =>
      ipcRenderer.invoke("player:setOutputDevice", deviceName),
    // 获取当前选择的输出设备名称
    getSelectedDeviceName: () => ipcRenderer.invoke("player:getSelectedDeviceName"),
    // 获取当前歌曲的原始高清封面（base64 data URL）
    getCoverRaw: () => ipcRenderer.invoke("player:getCoverRaw"),
    // 按需读取外部歌词文件内容
    readLyricFile: (filePath: string) => ipcRenderer.invoke("player:readLyricFile", filePath),
    // 同步播放模式到主进程（供托盘菜单显示）
    syncPlayMode: (repeatMode: string, shuffleMode: string) =>
      ipcRenderer.send("player:syncPlayMode", repeatMode, shuffleMode),
    // 订阅主进程推送的播放事件，返回取消订阅函数
    onEvent: (callback: (event: unknown) => void) => {
      ipcRenderer.removeAllListeners("player:event");
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data);
      ipcRenderer.on("player:event", handler);
      return () => ipcRenderer.removeListener("player:event", handler);
    },
  },
  system: {
    // 打开开发者工具
    toggleDevTools: () => ipcRenderer.invoke("system:toggleDevTools"),
    // 在文件管理器中显示文件
    showInExplorer: (filePath: string) => ipcRenderer.invoke("system:showInExplorer", filePath),
    // 同步语言到主进程
    setLocale: (locale: string) => ipcRenderer.send("system:setLocale", locale),
  },
  library: {
    // 开始扫描（默认增量）
    scan: (incremental?: boolean) => ipcRenderer.invoke("library:scan", incremental),
    // 取消扫描
    cancelScan: () => ipcRenderer.invoke("library:cancelScan"),
    // 获取全部曲目
    getTracks: () => ipcRenderer.invoke("library:getTracks"),
    // 搜索曲目
    searchTracks: (query: string) => ipcRenderer.invoke("library:searchTracks", query),
    // 获取曲目总数
    getTrackCount: () => ipcRenderer.invoke("library:getTrackCount"),
    // 获取扫描状态
    isScanning: () => ipcRenderer.invoke("library:isScanning"),
    // 弹出目录选择器，添加扫描目录
    addScanDir: () => ipcRenderer.invoke("library:addScanDir"),
    // 移除扫描目录及其下曲目
    removeScanDir: (dir: string) => ipcRenderer.invoke("library:removeScanDir", dir),
    // 获取已配置的扫描目录
    getScanDirs: () => ipcRenderer.invoke("library:getScanDirs"),
    // 删除曲目文件并从数据库移除
    deleteTracks: (paths: string[]) => ipcRenderer.invoke("library:deleteTracks", paths),
    // 获取歌手头像
    fetchArtistAvatar: (artistName: string) =>
      ipcRenderer.invoke("library:fetchArtistAvatar", artistName),
    // 订阅扫描进度事件
    onScanProgress: (callback: (progress: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data);
      ipcRenderer.on("library:scanProgress", handler);
      return () => ipcRenderer.removeListener("library:scanProgress", handler);
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
