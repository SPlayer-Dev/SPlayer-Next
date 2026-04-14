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
    translationColor: "#b3b3b3",
    alwaysOnTop: true,
    locked: false,
  },
  system: {
    rememberWindowState: true,
    taskbarProgress: true,
  },
};
