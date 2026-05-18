import { useMediaStore } from "@/stores/media";

/** 触发缓存所需的最低播放位置（毫秒） */
const TRIGGER_AT_MS = 20_000;

interface Pending {
  trackId: string;
  fire: () => void;
}

let pending: Pending | null = null;

/**
 * 调度一个延时缓存请求，自动覆盖上一首未触发的
 * @param trackId - 关联的 Track id，用于切歌时判别归属
 * @param fire - 实际触发缓存下载的回调
 */
export const schedule = (trackId: string, fire: () => void): void => {
  pending = { trackId, fire };
};

/** 取消当前 pending；切歌或新一轮加载前调用 */
export const cancel = (): void => {
  pending = null;
};

/**
 * 推进检查；由 position 事件驱动，到达阈值且当前曲目仍是被调度的那一首才触发
 * @param positionMs - 当前播放位置（毫秒）
 */
export const tick = (positionMs: number): void => {
  if (!pending) return;
  if (positionMs < TRIGGER_AT_MS) return;
  // 兜底：当前曲目已变
  if (useMediaStore().track?.id !== pending.trackId) {
    pending = null;
    return;
  }
  const fire = pending.fire;
  pending = null;
  fire();
};
