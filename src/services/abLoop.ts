/**
 * AB 循环服务
 *
 * 用户在进度条上设两个标记 A、B，播放到 B 自动 seek 回 A
 * - 切歌时自动重置（per-song 状态）
 * - B <= A 视为非法配置，自动 disable
 * - 与"音调同步"等其它播放修饰互不干扰
 */

import { useStatusStore } from "@/stores/status";
import * as player from "@/core/player";

/** 设 A 点（毫秒）；自动校验 B 关系，非法则 disable */
export const setA = (positionMs: number): void => {
  const { abLoop } = useStatusStore();
  abLoop.pointA = Math.max(0, Math.floor(positionMs));
  if (abLoop.pointB !== null && abLoop.pointB <= abLoop.pointA) {
    abLoop.enable = false;
  }
};

/** 设 B 点（毫秒）；自动校验 A 关系，非法则 disable */
export const setB = (positionMs: number): void => {
  const { abLoop } = useStatusStore();
  abLoop.pointB = Math.max(0, Math.floor(positionMs));
  if (abLoop.pointA !== null && abLoop.pointB <= abLoop.pointA) {
    abLoop.enable = false;
  }
};

/** 微调 A 点（增量秒，可正可负） */
export const nudgeA = (deltaSec: number): void => {
  const { abLoop } = useStatusStore();
  if (abLoop.pointA === null) return;
  setA(abLoop.pointA + deltaSec * 1000);
};

/** 微调 B 点 */
export const nudgeB = (deltaSec: number): void => {
  const { abLoop } = useStatusStore();
  if (abLoop.pointB === null) return;
  setB(abLoop.pointB + deltaSec * 1000);
};

export const clearA = (): void => {
  const { abLoop } = useStatusStore();
  abLoop.pointA = null;
  abLoop.enable = false;
};

export const clearB = (): void => {
  const { abLoop } = useStatusStore();
  abLoop.pointB = null;
  abLoop.enable = false;
};

/** 启用 / 关闭循环；启用前会校验两点存在且 B > A */
export const setEnabled = (on: boolean): void => {
  const { abLoop } = useStatusStore();
  if (on) {
    if (abLoop.pointA === null || abLoop.pointB === null) return;
    if (abLoop.pointB <= abLoop.pointA) return;
  }
  abLoop.enable = on;
};

/** 切歌时调用：清空两点和启用状态 */
export const reset = (): void => {
  const { abLoop } = useStatusStore();
  abLoop.enable = false;
  abLoop.pointA = null;
  abLoop.pointB = null;
};

/**
 * 位置事件钩子：到达 B 点跳回 A
 * 由 core/player.ts::onEnginePosition 每次拿到位置时调用
 */
export const checkLoop = (positionMs: number): void => {
  const { abLoop } = useStatusStore();
  if (!abLoop.enable) return;
  if (abLoop.pointA === null || abLoop.pointB === null) return;
  if (abLoop.pointB <= abLoop.pointA) return;
  if (positionMs >= abLoop.pointB) {
    player.seek(abLoop.pointA).catch(() => {});
  }
};
