import type { SystemConfig } from "../types/settings";
import { defaultPluginsConfig } from "./plugin-api";
import { defaultHotkeyConfig } from "./hotkeys";

/**
 * 灵动岛基准高度（缩放比例 = 1 时的物理像素，等于"主行高度")
 * 主行高度 = DYNAMIC_ISLAND_BASE_HEIGHT * scale
 * 双行模式下窗口最终高度 = 主行高度 + 副行高度
 * 主进程按渲染端上报的最终高度 setBounds
 */
export const DYNAMIC_ISLAND_BASE_HEIGHT = 40;

/** 默认配置 */
export const defaultSystemConfig: SystemConfig = {
  player: {
    autoPlay: false,
    rememberLastTrack: true,
    fadeEnabled: true,
    fadeDuration: 200,
    outputDevice: null,
    volume: 1,
    loudnessNormalization: false,
    equalizer: {
      enabled: false,
      preset: "flat",
      bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      preamp: 0,
    },
  },
  media: {
    systemMediaControls: true,
    discord: {
      enabled: false,
      showWhenPaused: false,
      displayMode: "name",
    },
  },
  library: {
    scanDirs: [],
  },
  desktopLyric: {
    fontSize: 24,
    fontWeight: 600,
    fontFamily: "",
    showTranslation: true,
    doubleLine: true,
    align: "center",
    wordByWord: true,
    autoGenerateWordByWord: true,
    playedColor: "rgb(254, 121, 113)",
    unplayedColor: "rgb(255, 255, 255)",
    strokeColor: "rgba(0, 0, 0, 0.5)",
    backgroundMask: false,
    backgroundMaskColor: "rgba(0, 0, 0, 0.3)",
    alwaysShowSongInfo: false,
    limitBounds: false,
    animation: true,
    alwaysOnTop: true,
    locked: false,
  },
  dynamicIsland: {
    scale: 1,
    fontWeight: 500,
    fontFamily: "",
    wordByWord: true,
    playedColor: "rgba(255, 255, 255, 1)",
    unplayedColor: "rgba(255, 255, 255, 0.5)",
    backgroundColor: "rgba(0, 0, 0, 1)",
    alwaysOnTop: true,
    snapCentered: true,
    nonOcclusive: false,
    doubleLine: false,
    showTranslation: false,
  },
  taskbarLyric: {
    position: "auto",
    autoMaxWidth: true,
    maxWidth: 400,
    colorMode: "taskbar",
    doubleLine: true,
    showTranslation: true,
    showCover: true,
    wordByWord: true,
    fontSize: 14,
    fontFamily: "",
  },
  lyric: {
    enableOnlineTTMLLyric: false,
    amllDbServer: "https://amlldb.bikonoo.com/%p/%s.ttml",
  },
  localLyric: {
    enableLocalTTMLOverride: false,
  },
  cache: {
    dir: null,
  },
  streaming: {
    enabled: true,
  },
  system: {
    rememberWindowState: true,
    taskbarProgress: true,
  },
  windowStates: {
    main: {
      width: 1280,
      height: 800,
      x: null,
      y: null,
      maximized: false,
    },
    desktopLyric: {
      width: 800,
      height: 200,
      x: null,
      y: null,
      visible: false,
    },
    dynamicIsland: {
      mode: "snapped",
      x: null,
      y: null,
      visible: false,
    },
    taskbarLyric: {
      visible: false,
    },
  },
  plugins: defaultPluginsConfig,
  hotkeys: defaultHotkeyConfig,
};
