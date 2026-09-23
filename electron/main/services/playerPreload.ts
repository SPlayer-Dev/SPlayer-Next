import { getPlayer } from "@main/services/engine";
import * as songCache from "@main/services/songCache";
import { store } from "@main/store";
import { playerLog } from "@main/utils/logger";

let prepared: { id: string; player: ReturnType<typeof getPlayer>; ready: boolean } | null = null;
let notifiedId: string | null = null;

/**
 * 曲尾只通知一次就绪槽位，隐藏窗口也能安排交接
 * @param remainingMs - 当前曲目剩余的源时间
 * @returns 尚未通知的就绪槽位标识
 */
export const takeTransitionReady = (remainingMs: number): string | null => {
  if (remainingMs > 6000) notifiedId = null;
  if (remainingMs < 1000 || remainingMs > 6000 || !prepared?.ready) return null;
  if (notifiedId === prepared.id) return null;
  notifiedId = prepared.id;
  return prepared.id;
};

/**
 * 取消下一曲准备任务并释放对应的缓存租约
 * @param id - 预载任务标识，省略时取消当前备用槽位
 */
export const cancelPreparedTrack = (id = prepared?.id): void => {
  if (!id) return;
  if (prepared?.id === id) {
    prepared.player.cancelPrepared(id);
    prepared = null;
  }
  songCache.cancelPreload(id);
};

/**
 * 将缓存完成的音源交给原生备用槽位解码
 * @param id - 用于取消和消费预载资源的任务标识
 * @param source - 本地音频文件或已完成下载的缓存文件路径
 * @param startMs - 预载起点，单位为毫秒，CUE 子曲目使用对应的起始位置
 * @returns 当前任务仍有效且音频已准备就绪时返回 true，否则返回 false
 */
export const prepareNextTrack = async (
  id: string,
  source: string,
  startMs = 0,
): Promise<boolean> => {
  cancelPreparedTrack();
  if (!store.get("cache.songCache.enabled")) {
    songCache.cancelPreload(id);
    return false;
  }
  const player = getPlayer();
  prepared = { id, player, ready: false };
  songCache.pinPreload(id, source);
  try {
    const ready = await player.prepareNext(id, source, startMs / 1000);
    if (!ready || prepared?.id !== id) {
      player.cancelPrepared(id);
      cancelPreparedTrack(id);
      return false;
    }
    prepared.ready = true;
    playerLog.info("下一曲 PCM 预载完成", { id, source });
    return true;
  } catch (error) {
    const current = prepared?.id === id;
    cancelPreparedTrack(id);
    if (current) await songCache.invalidate(source);
    throw error;
  }
};
