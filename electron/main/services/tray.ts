import { app, BrowserWindow, Menu, MenuItemConstructorOptions, nativeTheme, Tray } from "electron";
import type { RepeatMode, ShuffleMode } from "@shared/types/player";
import { broadcast } from "../utils/broadcast";
import { appName } from "../utils/config";
import { loadIcon, loadThemedIcon } from "../utils/icon";
import { trayLog } from "../utils/logger";

type PlayState = "playing" | "paused";

let tray: Tray | null = null;
let mainWin: BrowserWindow | null = null;
let playState: PlayState = "paused";
let songName = "";
let repeatMode: RepeatMode = "list";
let shuffleMode: ShuffleMode = "off";

const REPEAT_LABELS: Record<RepeatMode, string> = {
  list: "列表循环",
  one: "单曲循环",
  off: "不循环",
};
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
      click: () => {
        mainWin?.show();
        mainWin?.focus();
      },
    },
    { type: "separator" },
    {
      label: "上一曲",
      icon: menuIcon("prev"),
      click: () => broadcast("player:event", { type: "prev" }),
    },
    {
      label: playState === "paused" ? "播放" : "暂停",
      icon: menuIcon(playState === "paused" ? "play" : "pause"),
      click: () => broadcast("player:event", { type: playState === "paused" ? "play" : "pause" }),
    },
    {
      label: "下一曲",
      icon: menuIcon("next"),
      click: () => broadcast("player:event", { type: "next" }),
    },
    { type: "separator" },
    {
      label: shuffleMode === "on" ? "随机播放" : "顺序播放",
      icon: menuIcon("shuffle"),
      submenu: [
        {
          label: "随机播放",
          icon: menuIcon("shuffle"),
          type: "radio",
          checked: shuffleMode === "on",
          click: () => broadcast("player:event", { type: "setShuffle", data: { mode: "on" } }),
        },
        {
          label: "顺序播放",
          icon: menuIcon("shuffle"),
          type: "radio",
          checked: shuffleMode === "off",
          click: () => broadcast("player:event", { type: "setShuffle", data: { mode: "off" } }),
        },
      ],
    },
    {
      label: REPEAT_LABELS[repeatMode],
      icon: menuIcon(repeatMode === "one" ? "repeat-once" : "repeat"),
      submenu: [
        {
          label: "列表循环",
          icon: menuIcon("repeat"),
          type: "radio",
          checked: repeatMode === "list",
          click: () => broadcast("player:event", { type: "setRepeat", data: { mode: "list" } }),
        },
        {
          label: "单曲循环",
          icon: menuIcon("repeat-once"),
          type: "radio",
          checked: repeatMode === "one",
          click: () => broadcast("player:event", { type: "setRepeat", data: { mode: "one" } }),
        },
        {
          label: "不循环",
          icon: menuIcon("repeat"),
          type: "radio",
          checked: repeatMode === "off",
          click: () => broadcast("player:event", { type: "setRepeat", data: { mode: "off" } }),
        },
      ],
    },
    { type: "separator" },
    {
      label: "退出",
      icon: menuIcon("power"),
      click: () => app.quit(),
    },
  ];
  return Menu.buildFromTemplate(items);
};

/** 刷新菜单和 tooltip */
const refresh = (): void => {
  if (!tray) return;
  tray.setContextMenu(buildMenu());
  tray.setToolTip(songName || appName);
};

/**
 * 初始化系统托盘
 * @param win - 主窗口实例
 */
export const initTray = (win: BrowserWindow): void => {
  mainWin = win;
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
  tray.on("click", () => {
    mainWin?.show();
    mainWin?.focus();
  });
  // 系统主题变化时刷新菜单图标
  nativeTheme.on("updated", refresh);
  trayLog.info("初始化系统托盘");
};

/**
 * 更新托盘歌曲名称
 * @param name - 歌曲显示名称
 */
export const setTraySongName = (name: string): void => {
  // 限制显示长度，避免菜单过宽
  songName = name.length > 20 ? name.slice(0, 20) + "..." : name;
  refresh();
};

/**
 * 更新托盘播放状态
 * @param state - 播放状态
 */
export const setTrayPlayState = (state: PlayState): void => {
  playState = state;
  refresh();
};

/**
 * 同步播放模式到托盘（由渲染进程调用）
 * @param repeat - 循环模式
 * @param shuffle - 随机模式
 */
export const setTrayPlayMode = (repeat: RepeatMode, shuffle: ShuffleMode): void => {
  repeatMode = repeat;
  shuffleMode = shuffle;
  refresh();
};

/** 销毁托盘 */
export const destroyTray = (): void => {
  tray?.destroy();
  tray = null;
};
