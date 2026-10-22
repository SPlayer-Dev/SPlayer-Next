import { powerSaveBlocker } from "electron";
import type { PlayerState } from "@shared/types/player";
import { store } from "@main/store";
import { systemLog } from "./logger";

let suspensionBlockerId: number | null = null;
let displayBlockerId: number | null = null;
let playbackState: PlayerState = "idle";
let playerExpanded = false;
let mainWindowVisible = false;

/** 按播放状态、播放页和窗口可见性更新两类电源抑制 */
export const refreshPowerBlocker = (): void => {
  const audioActive = playbackState === "playing" || playbackState === "loading";
  const displayActive =
    store.get("player.keepScreenAwake") &&
    playerExpanded &&
    mainWindowVisible &&
    playbackState === "playing";

  if (audioActive && suspensionBlockerId === null) {
    suspensionBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    systemLog.info(`已启用休眠抑制 (id: ${suspensionBlockerId})`);
  } else if (!audioActive && suspensionBlockerId !== null) {
    powerSaveBlocker.stop(suspensionBlockerId);
    systemLog.info(`已释放休眠抑制 (id: ${suspensionBlockerId})`);
    suspensionBlockerId = null;
  }

  if (displayActive && displayBlockerId === null) {
    displayBlockerId = powerSaveBlocker.start("prevent-display-sleep");
    systemLog.info(`已启用屏幕常亮 (id: ${displayBlockerId})`);
  } else if (!displayActive && displayBlockerId !== null) {
    powerSaveBlocker.stop(displayBlockerId);
    systemLog.info(`已释放屏幕常亮 (id: ${displayBlockerId})`);
    displayBlockerId = null;
  }
};

/**
 * 从原生播放事件更新电源策略
 * @param state - 原生播放器状态
 */
export const updatePowerBlocker = (state: PlayerState): void => {
  playbackState = state;
  refreshPowerBlocker();
};

/**
 * 同步主窗口播放页展开状态
 * @param expanded - 播放页是否展开
 */
export const setPlayerExpanded = (expanded: boolean): void => {
  playerExpanded = expanded;
  refreshPowerBlocker();
};

/**
 * 同步主窗口是否可供查看
 * @param visible - 窗口是否可见且未最小化
 */
export const setMainWindowVisible = (visible: boolean): void => {
  mainWindowVisible = visible;
  refreshPowerBlocker();
};

/** 退出前释放全部电源抑制并清空播放页状态 */
export const releasePowerBlocker = (): void => {
  playbackState = "idle";
  playerExpanded = false;
  mainWindowVisible = false;
  refreshPowerBlocker();
};
