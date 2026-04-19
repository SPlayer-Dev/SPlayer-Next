import { app, Menu, MenuItemConstructorOptions, nativeTheme, Tray } from "electron";
import type { RepeatMode, ShuffleMode } from "@shared/types/player";
import { broadcast } from "@main/utils/broadcast";
import { appName } from "@main/utils/config";
import { loadIcon, loadThemedIcon } from "@main/utils/icon";
import { t } from "@main/utils/i18n";
import { trayLog } from "@main/utils/logger";
import {
  toggleDesktopLyricWindow,
  toggleDynamicIslandWindow,
  toggleTaskbarLyricWindow,
  focusMainWindow,
} from "@main/window";

type PlayState = "playing" | "paused";

let tray: Tray | null = null;
let playState: PlayState = "paused";
let songName = "";
let repeatMode: RepeatMode = "list";
let shuffleMode: ShuffleMode = "off";
let desktopLyricOpen = false;
let dynamicIslandOpen = false;
let taskbarLyricOpen = false;

const repeatLabel = (mode: RepeatMode): string =>
  ({ list: t("repeatList"), one: t("repeatOne"), off: t("repeatOff") })[mode];

/** 获取菜单图标 */
const menuIcon = (name: string) => {
  try {
    return loadThemedIcon("tray", name, { width: 16, height: 16 });
  } catch {
    return undefined;
  }
};

/** 构建右键菜单 */
const buildMenu = (): Menu => {
  const items: MenuItemConstructorOptions[] = [
    {
      label: songName || appName,
      icon: menuIcon("music"),
      enabled: !!songName,
      click: () => focusMainWindow(),
    },
    { type: "separator" },
    {
      label: t("prev"),
      icon: menuIcon("prev"),
      click: () => broadcast("player:event", { type: "prev" }),
    },
    {
      label: playState === "paused" ? t("play") : t("pause"),
      icon: menuIcon(playState === "paused" ? "play" : "pause"),
      click: () => broadcast("player:event", { type: playState === "paused" ? "play" : "pause" }),
    },
    {
      label: t("next"),
      icon: menuIcon("next"),
      click: () => broadcast("player:event", { type: "next" }),
    },
    { type: "separator" },
    {
      label: shuffleMode === "on" ? t("shuffle") : t("sequential"),
      icon: menuIcon("shuffle"),
      submenu: [
        {
          label: t("shuffle"),
          icon: menuIcon("shuffle"),
          type: "radio",
          checked: shuffleMode === "on",
          click: () => broadcast("player:event", { type: "setShuffle", data: { mode: "on" } }),
        },
        {
          label: t("sequential"),
          icon: menuIcon("shuffle"),
          type: "radio",
          checked: shuffleMode === "off",
          click: () => broadcast("player:event", { type: "setShuffle", data: { mode: "off" } }),
        },
      ],
    },
    {
      label: repeatLabel(repeatMode),
      icon: menuIcon(repeatMode === "one" ? "repeat-once" : "repeat"),
      submenu: [
        {
          label: t("repeatList"),
          icon: menuIcon("repeat"),
          type: "radio",
          checked: repeatMode === "list",
          click: () => broadcast("player:event", { type: "setRepeat", data: { mode: "list" } }),
        },
        {
          label: t("repeatOne"),
          icon: menuIcon("repeat-once"),
          type: "radio",
          checked: repeatMode === "one",
          click: () => broadcast("player:event", { type: "setRepeat", data: { mode: "one" } }),
        },
        {
          label: t("repeatOff"),
          icon: menuIcon("repeat"),
          type: "radio",
          checked: repeatMode === "off",
          click: () => broadcast("player:event", { type: "setRepeat", data: { mode: "off" } }),
        },
      ],
    },
    { type: "separator" },
    {
      label: desktopLyricOpen ? t("closeDesktopLyric") : t("openDesktopLyric"),
      icon: menuIcon("lyric"),
      click: () => toggleDesktopLyricWindow(),
    },
    {
      label: dynamicIslandOpen ? t("closeDynamicIsland") : t("openDynamicIsland"),
      icon: menuIcon("lyric"),
      click: () => toggleDynamicIslandWindow(),
    },
    ...(process.platform === "win32"
      ? [
          {
            label: taskbarLyricOpen ? t("closeTaskbarLyric") : t("openTaskbarLyric"),
            icon: menuIcon("lyric"),
            click: () => toggleTaskbarLyricWindow(),
          } as MenuItemConstructorOptions,
        ]
      : []),
    { type: "separator" },
    {
      label: t("quit"),
      icon: menuIcon("power"),
      click: () => app.quit(),
    },
  ];
  return Menu.buildFromTemplate(items);
};

/** 刷新菜单和 tooltip */
export const refreshTray = (): void => {
  if (!tray) return;
  tray.setContextMenu(buildMenu());
  tray.setToolTip(songName || appName);
};

/** 初始化系统托盘 */
export const initTray = (): void => {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  let icon: string | Electron.NativeImage;
  if (isWin) {
    icon = loadIcon("tray/tray.ico");
  } else if (isMac) {
    icon = loadIcon("tray/tray-light.png", { width: 19, height: 19 });
    icon.setTemplateImage(true);
  } else {
    icon = loadIcon("tray/tray@32.png", { width: 20, height: 20 });
  }
  tray = new Tray(icon);
  tray.setToolTip(appName);
  tray.setContextMenu(buildMenu());
  // 单击托盘图标显示窗口
  tray.on("click", () => focusMainWindow());
  // 系统主题变化时刷新菜单图标
  nativeTheme.on("updated", refreshTray);
  trayLog.info("初始化系统托盘");
};

/**
 * 更新托盘歌曲名称
 * @param name - 歌曲显示名称
 */
export const setTraySongName = (name: string): void => {
  // 限制显示长度，避免菜单过宽
  songName = name.length > 20 ? name.slice(0, 20) + "..." : name;
  refreshTray();
};

/**
 * 更新托盘播放状态
 * @param state - 播放状态
 */
export const setTrayPlayState = (state: PlayState): void => {
  playState = state;
  refreshTray();
};

/**
 * 同步播放模式到托盘（由渲染进程调用）
 * @param repeat - 循环模式
 * @param shuffle - 随机模式
 */
export const setTrayPlayMode = (repeat: RepeatMode, shuffle: ShuffleMode): void => {
  repeatMode = repeat;
  shuffleMode = shuffle;
  refreshTray();
};

/** 同步桌面歌词窗口开关状态到托盘 */
export const setTrayDesktopLyric = (open: boolean): void => {
  if (desktopLyricOpen === open) return;
  desktopLyricOpen = open;
  refreshTray();
};

/** 同步灵动岛窗口开关状态到托盘 */
export const setTrayDynamicIsland = (open: boolean): void => {
  if (dynamicIslandOpen === open) return;
  dynamicIslandOpen = open;
  refreshTray();
};

/** 同步任务栏歌词窗口开关状态到托盘 */
export const setTrayTaskbarLyric = (open: boolean): void => {
  if (taskbarLyricOpen === open) return;
  taskbarLyricOpen = open;
  refreshTray();
};

/** 销毁托盘 */
export const destroyTray = (): void => {
  tray?.destroy();
  tray = null;
};
