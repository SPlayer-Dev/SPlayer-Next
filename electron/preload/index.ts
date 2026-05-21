import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type { TaskbarLyricSettings } from "@shared/types/settings";
import type { PluginInfo, PluginResolveUrlArgs } from "@shared/types/plugin";
import type { HotkeyActionId, HotkeyBinding, HotkeyConflict } from "@shared/types/hotkey";
import type { LoadOptions, TrackSource } from "@shared/types/player";
import type { StreamingServerConfig } from "@shared/types/streaming";
import type { PlayEventInput, FavoriteEventInput } from "@shared/types/stats";

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
    replaceAll: (config: unknown) => ipcRenderer.invoke("config:replaceAll", config),
    exportToFile: (
      payload: unknown,
    ): Promise<{ ok: boolean; reason?: "canceled" | "writeFailed" }> =>
      ipcRenderer.invoke("config:exportToFile", payload),
    importFromFile: (): Promise<
      { ok: true; data: unknown } | { ok: false; reason: "canceled" | "readFailed" | "parseFailed" }
    > => ipcRenderer.invoke("config:importFromFile"),
  },
  player: {
    // 加载音频（本地路径或网络地址）
    load: (source: string, options?: LoadOptions) =>
      ipcRenderer.invoke("player:load", source, options ?? {}),
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
    // 启用/禁用 10 频段均衡器
    setEqualizerEnabled: (enabled: boolean) =>
      ipcRenderer.invoke("player:setEqualizerEnabled", enabled),
    // 更新均衡器各频段增益（dB 数组，长度 10）
    setEqualizerBands: (gainsDb: number[]) =>
      ipcRenderer.invoke("player:setEqualizerBands", gainsDb),
    // 设置前级增益（dB）
    setPreampGain: (preampDb: number) => ipcRenderer.invoke("player:setPreampGain", preampDb),
    // 设置播放速度（0.5 ~ 2.0），引擎侧自动 clamp
    setSpeed: (speed: number) => ipcRenderer.invoke("player:setSpeed", speed),
    // 设置音调偏移（半音 -12 ~ 12），引擎侧自动 clamp
    setPitch: (semitones: number) => ipcRenderer.invoke("player:setPitch", semitones),
    // 设置"音调同步"开关（true = 变速保音调）
    setPitchSync: (sync: boolean) => ipcRenderer.invoke("player:setPitchSync", sync),
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
    // 获取系统已安装字体
    listFonts: () => ipcRenderer.invoke("system:listFonts"),
    // 拉远端字节回渲染层
    fetchRemoteBytes: (url: string) => ipcRenderer.invoke("system:fetchRemoteBytes", url),
    // 重启应用
    relaunch: () => ipcRenderer.invoke("system:relaunch"),
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
    // 随机取一首曲目
    getRandomTrack: () => ipcRenderer.invoke("library:getRandomTrack"),
    // 随机取多首曲目
    getRandomTracks: (limit: number) => ipcRenderer.invoke("library:getRandomTracks", limit),
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
    // 切换任务栏歌词窗口
    toggleTaskbarLyric: () => ipcRenderer.invoke("window:toggleTaskbarLyric"),
    // 关闭任务栏歌词窗口
    closeTaskbarLyric: () => ipcRenderer.invoke("window:closeTaskbarLyric"),
    // 查询任务栏歌词窗口是否打开
    isTaskbarLyricOpen: () => ipcRenderer.invoke("window:isTaskbarLyricOpen"),
    // 订阅任务栏歌词窗口开关状态
    onTaskbarLyricVisibilityChange: (callback: (open: boolean) => void) =>
      subscribe<boolean>("taskbarLyric:visibilityChange", callback),
    // 主窗口控制
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggleMaximize"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
    onMaximizeChange: (callback: (maximized: boolean) => void) =>
      subscribe<boolean>("window:maximizeChange", callback),
    toggleFullscreen: () => ipcRenderer.send("window:toggleFullscreen"),
    isFullscreen: () => ipcRenderer.invoke("window:isFullscreen"),
    onFullscreenChange: (callback: (fullscreen: boolean) => void) =>
      subscribe<boolean>("window:fullscreenChange", callback),
    hide: () => ipcRenderer.send("window:hide"),
    quit: () => ipcRenderer.send("window:quit"),
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
    // 渲染端上报目标宽度，主进程立即 resize
    resize: (width: number) => ipcRenderer.send("dynamicIsland:resize", width),
    // 渲染端上报目标高度
    setHeight: (height: number) => ipcRenderer.send("dynamicIsland:setHeight", height),
    // 查询当前吸附模式
    getMode: () => ipcRenderer.invoke("dynamicIsland:getMode"),
    // 订阅吸附模式变化：snapped（顶部居中）/ floating（自由位置）
    onModeChange: (callback: (mode: "snapped" | "floating") => void) =>
      subscribe<"snapped" | "floating">("dynamicIsland:modeChange", callback),
    // 订阅主进程 screen 光标位置判定（非遮挡模式下用于悬停隐藏）
    onCursorInside: (callback: (inside: boolean) => void) =>
      subscribe<boolean>("dynamicIsland:cursorInside", callback),
  },
  taskbarLyric: {
    // 订阅布局变化（锚定方向、是否居中、系统类型、任务栏主题）
    onLayout: (
      callback: (data: {
        isCentered: boolean;
        systemType: string;
        isLight: boolean;
        anchor: "left" | "right";
      }) => void,
    ) =>
      subscribe<{
        isCentered: boolean;
        systemType: string;
        isLight: boolean;
        anchor: "left" | "right";
      }>("taskbarLyric:layout", callback),
    // 订阅任务栏歌词配置变化
    onConfigChange: (callback: (config: TaskbarLyricSettings) => void) =>
      subscribe<TaskbarLyricSettings>("taskbarLyric:configChange", callback),
  },
  plugins: {
    // 列出所有已安装插件
    list: () => ipcRenderer.invoke("plugin:list"),
    // 从指定路径导入插件
    install: (filePath: string) => ipcRenderer.invoke("plugin:install", filePath),
    // 弹出原生文件选择框导入插件
    pickAndInstall: () => ipcRenderer.invoke("plugin:pickAndInstall"),
    // 从远端 URL 下载并导入
    installFromUrl: (url: string) => ipcRenderer.invoke("plugin:installFromUrl", url),
    // 卸载
    uninstall: (id: string) => ipcRenderer.invoke("plugin:uninstall", id),
    // 启用/禁用
    setEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke("plugin:setEnabled", id, enabled),
    // 解析播放 URL
    resolveUrl: (args: PluginResolveUrlArgs) => ipcRenderer.invoke("plugin:resolveUrl", args),
    // 订阅插件状态变化
    onStatus: (callback: (info: PluginInfo) => void) =>
      subscribe<PluginInfo>("plugin:status", callback),
  },
  apis: {
    // 调用任意平台的任意接口
    call: (platform: string, name: string, params?: Record<string, unknown>) =>
      ipcRenderer.invoke("apis:call", platform, name, params ?? {}),
    // 清空指定平台的登录态
    clearSession: (platform: string) => ipcRenderer.invoke("apis:clearSession", platform),
    // 打开官方网页登录窗口
    openLoginWeb: (platform: string) => ipcRenderer.invoke("apis:openLoginWeb", platform),
    // 手动写入 cookie 登录
    setCookie: (platform: string, cookie: string) =>
      ipcRenderer.invoke("apis:setCookie", platform, cookie),
  },
  lyrics: {
    // 按 id 直取某平台歌词
    matchById: (platform: string, id: string) =>
      ipcRenderer.invoke("lyrics:matchById", platform, id),
    // 按 Track 元数据在某平台模糊搜索歌词
    matchByQuery: (platform: string, track: unknown) =>
      ipcRenderer.invoke("lyrics:matchByQuery", platform, track),
    // 获取 AMLL TTML DB 的 TTML
    fetchTTMLOverlay: (track: unknown, platform: string) =>
      ipcRenderer.invoke("lyrics:fetchTTMLOverlay", track, platform),
  },
  nowPlaying: {
    // 渲染进程同步当前播放状态到主进程
    update: (payload: unknown) => ipcRenderer.send("nowPlaying:update", payload),
    // 拉取当前完整快照
    requestSnapshot: () => ipcRenderer.invoke("nowPlaying:requestSnapshot"),
    // 写入指定曲目的歌词偏移（ms），0 视为清除
    setLyricOffset: (trackId: string, offsetMs: number) =>
      ipcRenderer.send("nowPlaying:setLyricOffset", trackId, offsetMs),
    // 订阅歌曲切换事件
    onTrackChange: (callback: (data: unknown) => void) =>
      subscribe("nowPlaying:track-change", callback),
    // 订阅歌词内容变化事件
    onLyricChange: (callback: (snapshot: unknown) => void) =>
      subscribe("nowPlaying:lyric-change", callback),
    // 订阅播放位置锚点（跟随 position 事件 5Hz）
    onPositionSync: (callback: (data: unknown) => void) =>
      subscribe("nowPlaying:position-sync", callback),
    // 订阅当前曲目歌词偏移变化
    onLyricOffsetChange: (callback: (data: unknown) => void) =>
      subscribe("nowPlaying:lyric-offset-change", callback),
  },
  theme: {
    // 弹出文件选择框
    pickBackgroundImage: (): Promise<string | null> =>
      ipcRenderer.invoke("theme:pickBackgroundImage"),
    // 清空已缓存的背景图
    clearBackgroundImages: (): Promise<void> => ipcRenderer.invoke("theme:clearBackgroundImages"),
  },
  cache: {
    // 各类别占用统计
    getStats: () => ipcRenderer.invoke("cache:getStats"),
    // 清除单个类别
    clear: (id: string) => ipcRenderer.invoke("cache:clear", id),
    // 按介质清空
    clearAllByKind: (kind: "file" | "db") => ipcRenderer.invoke("cache:clearAllByKind", kind),
    // 获取当前缓存目录
    getDir: () => ipcRenderer.invoke("cache:getDir"),
    // 选择新的缓存目录
    pickDir: () => ipcRenderer.invoke("cache:pickDir"),
    // 还原默认缓存目录
    resetDir: () => ipcRenderer.invoke("cache:resetDir"),
    // 单曲文件缓存运行时
    song: {
      // 命中查询：返回本地绝对路径或 null
      lookup: (cacheKey: string): Promise<string | null> =>
        ipcRenderer.invoke("cache:song:lookup", cacheKey),
      // 排队下载（fire-and-forget 也可 await）
      fetch: (cacheKey: string, source: TrackSource, streamUrl: string): Promise<string | null> =>
        ipcRenderer.invoke("cache:song:fetch", cacheKey, source, streamUrl),
      // 取消正在进行的下载
      cancel: (cacheKey: string): Promise<void> =>
        ipcRenderer.invoke("cache:song:cancel", cacheKey),
    },
  },
  streaming: {
    // 加载服务器配置（密码已解密）
    loadServers: () => ipcRenderer.invoke("streaming:loadServers"),
    // 持久化服务器配置（密码经 safeStorage 加密）
    saveServers: (payload: {
      servers: StreamingServerConfig[];
      activeServerId: string | null;
    }): Promise<void> => ipcRenderer.invoke("streaming:saveServers", payload),
  },
  externalApi: {
    // 重启外部 API 服务
    restart: () => ipcRenderer.invoke("externalApi:restart"),
    // 查询当前运行状态
    getStatus: () => ipcRenderer.invoke("externalApi:getStatus"),
  },
  stats: {
    // 记录一次播放
    recordPlay: (event: PlayEventInput) => ipcRenderer.send("stats:recordPlay", event),
    // 记录一次收藏变更
    recordFavorite: (event: FavoriteEventInput) => ipcRenderer.send("stats:recordFavorite", event),
    // 取播放统计汇总
    getStatsSummary: () => ipcRenderer.invoke("stats:getStatsSummary"),
    // 取最常播放的曲目
    getTopTracks: (limit: number) => ipcRenderer.invoke("stats:getTopTracks", limit),
  },
  hotkey: {
    getAll: () => ipcRenderer.invoke("hotkey:getAll"),
    set: (id: HotkeyActionId, binding: HotkeyBinding) =>
      ipcRenderer.invoke("hotkey:set", id, binding),
    reset: (id?: HotkeyActionId) => ipcRenderer.invoke("hotkey:reset", id),
    setGlobalEnabled: (enabled: boolean) => ipcRenderer.invoke("hotkey:setGlobalEnabled", enabled),
    probe: (accelerator: string) => ipcRenderer.invoke("hotkey:probe", accelerator),
    getConflicts: () => ipcRenderer.invoke("hotkey:getConflicts"),
    onTrigger: (callback: (id: HotkeyActionId) => void) =>
      subscribe<HotkeyActionId>("hotkey:trigger", callback),
    onConflicts: (callback: (conflicts: HotkeyConflict[]) => void) =>
      subscribe<HotkeyConflict[]>("hotkey:conflicts", callback),
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
