/**
 * 非响应式播放时间源
 *
 * 歌词高亮、频谱等高频组件直接读取，不经过 Vue 响应式系统
 * 进度条等低频 UI 仍从 status store 读取
 *
 * 主进程推送位置时调用 setCurrentTime 更新
 * 高频组件在自己的 RAF 循环中调用 getCurrentTime 读取
 */

/** 当前播放位置（毫秒） */
let currentTimeMs = 0;

/** 总时长（毫秒） */
let totalDurationMs = 0;

/** 上次同步的本地时间戳 */
let lastSyncAt = 0;

/** 是否正在播放（用于插值计算） */
let playing = false;

/** 获取当前播放位置（毫秒），播放中自动插值 */
export const getCurrentTime = (): number => {
  if (!playing) return currentTimeMs;
  const elapsed = performance.now() - lastSyncAt;
  return Math.min(currentTimeMs + elapsed, totalDurationMs);
};

/** 获取总时长（毫秒） */
export const getDuration = (): number => totalDurationMs;

/** 是否正在播放 */
export const isPlaying = (): boolean => playing;

/** 由 status store 调用：同步主进程推送的位置 */
export const setCurrentTime = (ms: number): void => {
  currentTimeMs = ms;
  lastSyncAt = performance.now();
};

/** 由 status store 调用：同步时长 */
export const setDuration = (ms: number): void => {
  totalDurationMs = ms;
};

/** 由 status store 调用：同步播放状态 */
export const setPlaying = (value: boolean): void => {
  if (value && !playing) {
    // 恢复播放时重置同步时间，避免插值跳跃
    lastSyncAt = performance.now();
  }
  playing = value;
};

/** 重置所有状态 */
export const reset = (): void => {
  currentTimeMs = 0;
  totalDurationMs = 0;
  lastSyncAt = 0;
  playing = false;
};
