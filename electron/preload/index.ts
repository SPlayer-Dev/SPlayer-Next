import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

/** 订阅主进程推送的事件 */
const subscribe = <T>(channel: string, callback: (data: T) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, data: T): void => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

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
    // 广播播放控制事件到所有渲染进程
    dispatch: (type: string) => ipcRenderer.send("player:dispatch", type),
    // 订阅主进程推送的播放事件
    onEvent: (callback: (event: unknown) => void) => subscribe("player:event", callback),
  },
  system: {
    // 打开开发者工具
    toggleDevTools: () => ipcRenderer.invoke("system:toggleDevTools"),
    // 在文件管理器中显示文件
    showInExplorer: (filePath: string) => ipcRenderer.invoke("system:showInExplorer", filePath),
    // 同步语言到主进程
    setLocale: (locale: string) => ipcRenderer.send("system:setLocale", locale),
    // 显示并聚焦主窗口
    focusMainWindow: () => ipcRenderer.invoke("system:focusMainWindow"),
    // 在主窗口打开设置弹窗
    openSettings: (category?: string, highlight?: string) =>
      ipcRenderer.invoke("system:openSettings", category, highlight),
    // 主窗口监听"打开设置"事件
    onOpenSettings: (callback: (payload: { category?: string; highlight?: string }) => void) =>
      subscribe<{ category?: string; highlight?: string }>("system:openSettings", callback),
  },
  library: {
    // 开始扫描（默认增量）
    scan: (incremental?: boolean) => ipcRenderer.invoke("library:scan", incremental),
    // 取消扫描
    cancelScan: () => ipcRenderer.invoke("library:cancelScan"),
    // 获取全部曲目
    getTracks: () => ipcRenderer.invoke("library:getTracks"),
    // 获取专辑聚合列表
    getAlbums: () => ipcRenderer.invoke("library:getAlbums"),
    // 获取歌手聚合列表
    getArtists: () => ipcRenderer.invoke("library:getArtists"),
    // 获取某专辑下的全部曲目
    getAlbumTracks: (albumName: string) => ipcRenderer.invoke("library:getAlbumTracks", albumName),
    // 获取某歌手的全部曲目
    getArtistTracks: (artistName: string) =>
      ipcRenderer.invoke("library:getArtistTracks", artistName),
    // 按 ID 批量获取曲目
    getTracksByIds: (ids: string[]) => ipcRenderer.invoke("library:getTracksByIds", ids),
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
    // 预取歌手头像
    prefetchArtistAvatars: (artistNames: string[]) =>
      ipcRenderer.invoke("library:prefetchArtistAvatars", artistNames),
    // 订阅扫描进度事件
    onScanProgress: (callback: (progress: unknown) => void) =>
      subscribe("library:scanProgress", callback),
  },
  window: {
    // 切换桌面歌词窗口
    toggleDesktopLyric: () => ipcRenderer.invoke("window:toggleDesktopLyric"),
    // 关闭桌面歌词窗口
    closeDesktopLyric: () => ipcRenderer.invoke("window:closeDesktopLyric"),
    // 查询桌面歌词窗口是否打开
    isDesktopLyricOpen: () => ipcRenderer.invoke("window:isDesktopLyricOpen"),
    // 订阅桌面歌词窗口开关状态
    onDesktopLyricVisibilityChange: (callback: (open: boolean) => void) =>
      subscribe<boolean>("desktopLyric:visibilityChange", callback),
    // 切换灵动岛窗口
    toggleDynamicIsland: () => ipcRenderer.invoke("window:toggleDynamicIsland"),
    // 关闭灵动岛窗口
    closeDynamicIsland: () => ipcRenderer.invoke("window:closeDynamicIsland"),
    // 查询灵动岛窗口是否打开
    isDynamicIslandOpen: () => ipcRenderer.invoke("window:isDynamicIslandOpen"),
    // 订阅灵动岛窗口开关状态
    onDynamicIslandVisibilityChange: (callback: (open: boolean) => void) =>
      subscribe<boolean>("dynamicIsland:visibilityChange", callback),
  },
  desktopLyric: {
    // 订阅桌面歌词配置变化
    onConfigChange: (callback: (config: unknown) => void) =>
      subscribe("desktopLyric:configChange", callback),
    // 将窗口高度锁定到指定像素
    setHeight: (height: number) => ipcRenderer.invoke("desktopLyric:setHeight", height),
    // 锁定态下切换鼠标穿透
    setMouseIgnore: (ignore: boolean) => ipcRenderer.send("desktopLyric:setMouseIgnore", ignore),
    // 拖拽移动；只传位置，尺寸由主进程权威 cachedSize 写回
    move: (x: number, y: number) => ipcRenderer.send("desktopLyric:move", x, y),
    // 拖拽结束后保存最终位置
    saveState: () => ipcRenderer.send("desktopLyric:saveState"),
    // 订阅主进程 screen 光标位置轮询
    onCursorInside: (callback: (inside: boolean) => void) =>
      subscribe<boolean>("desktopLyric:cursorInside", callback),
  },
  dynamicIsland: {
    // 订阅灵动岛配置变化
    onConfigChange: (callback: (config: unknown) => void) =>
      subscribe("dynamicIsland:configChange", callback),
    // 拖拽移动；只传位置，尺寸由主进程权威写回
    move: (x: number, y: number) => ipcRenderer.send("dynamicIsland:move", x, y),
    // 拖拽结束后保存最终位置；主进程会在落点近顶部时自动吸附回居中
    saveState: () => ipcRenderer.send("dynamicIsland:saveState"),
    // 订阅吸附模式变化：snapped（顶部居中）/ floating（自由位置）
    onModeChange: (callback: (mode: "snapped" | "floating") => void) =>
      subscribe<"snapped" | "floating">("dynamicIsland:modeChange", callback),
  },
  nowPlaying: {
    // 渲染进程同步当前播放状态到主进程
    update: (payload: unknown) => ipcRenderer.send("nowPlaying:update", payload),
    // 拉取当前完整快照
    requestSnapshot: () => ipcRenderer.invoke("nowPlaying:requestSnapshot"),
    // 订阅歌曲切换事件
    onTrackChange: (callback: (data: unknown) => void) =>
      subscribe("nowPlaying:track-change", callback),
    // 订阅歌词内容变化事件
    onLyricChange: (callback: (snapshot: unknown) => void) =>
      subscribe("nowPlaying:lyric-change", callback),
    // 订阅播放位置锚点（跟随 position 事件 5Hz）
    onPositionSync: (callback: (data: unknown) => void) =>
      subscribe("nowPlaying:position-sync", callback),
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
