import { powerSaveBlocker } from "electron";
import { systemLog } from "./logger";

let blockerId: number | null = null;

/**
 * 按播放状态更新系统休眠抑制
 *
 * 播放中（含缓冲 loading）通过 prevent-app-suspension 阻止系统睡眠，
 * 其它状态立即释放，避免空闲时持续占用唤醒锁导致无法休眠
 * @param active - 是否有正在进行的播放
 */
export const updatePowerBlocker = (active: boolean): void => {
  if (active && blockerId === null) {
    blockerId = powerSaveBlocker.start("prevent-app-suspension");
    systemLog.info(`已启用休眠抑制 (id: ${blockerId})`);
  } else if (!active && blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    systemLog.info(`已释放休眠抑制 (id: ${blockerId})`);
    blockerId = null;
  }
};

/** 释放休眠抑制（应用退出前调用） */
export const releasePowerBlocker = (): void => updatePowerBlocker(false);
