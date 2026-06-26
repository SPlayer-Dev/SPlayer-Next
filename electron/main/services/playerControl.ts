/**
 * 播放控制聚合入口
 *
 * 把"外部来源"（系统媒体、HTTP/WS 外部 API、控制类插件）发起的播放控制
 * 收敛到一处：引擎直控 + 必要时通知渲染层补记账。
 */

import { getPlayer } from "@main/services/engine";
import { sendToMain } from "@main/utils/broadcast";
import { toMs } from "@main/utils/time";

/**
 * 跳转（毫秒）
 *
 * 返回的 Promise 透传引擎结果：WS/REST 等外部入口据此反馈失败；插件侧即发即忘，自行忽略即可。
 * @param positionMs - 目标位置（毫秒）
 */
const seek = (positionMs: number): Promise<void> => {
  sendToMain("player:event", { type: "seek", data: { position: positionMs } });
  return getPlayer().seek(positionMs / 1000);
};

export const playerControl = {
  play: (): void =>
    void getPlayer()
      .play()
      .catch(() => {}),
  pause: (): void => getPlayer().pause(),
  stop: (): void => getPlayer().stop(),
  next: (): void => sendToMain("player:event", { type: "next" }),
  prev: (): void => sendToMain("player:event", { type: "prev" }),
  seek,
  setVolume: (volume: number): void => getPlayer().setVolume(volume),
  /** 当前播放进度（毫秒） */
  getPosition: (): number => toMs(getPlayer().getPosition()),
};
