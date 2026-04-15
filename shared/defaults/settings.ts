import type { SystemConfig } from "../types/settings";

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
    showTranslation: true,
    doubleLine: true,
    align: "center",
    wordByWord: true,
    autoGenerateWordByWord: true,
    playedColor: "#ffffff",
    unplayedColor: "#7d7d7d",
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
    height: 40,
    fontWeight: 500,
    wordByWord: true,
    playedColor: "#ffffff",
    unplayedColor: "rgba(255, 255, 255, 0.5)",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    alwaysOnTop: true,
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
    },
    dynamicIsland: {
      mode: "snapped",
      x: null,
      y: null,
    },
  },
};
