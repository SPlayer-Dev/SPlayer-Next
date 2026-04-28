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

/** 是否正在播放 */
let playing = false;

/** 是否正在 seek（暂停插值，固定在 seek 目标位置） */
let seeking = false;

/**
 * 当前播放速度倍率（用于把墙钟插值换算到源时间）
 * 变速时 1ms 墙钟 = speed ms 源时间
 */
let speed = 1.0;

/**
 * 主进程推送位置与本地插值之间的容差（毫秒）
 * 偏差小于此值视作 IPC 延迟 / 解码抖动，保留插值避免可见跳跃；
 * 大于此值视作真实跳变（漏拦截的 seek、跳曲等），直接采用推送值
 */
const SYNC_TOLERANCE_MS = 1000;

/** 获取当前播放位置（毫秒），播放中按 speed 插值，seek 中冻结 */
export const getCurrentTime = (): number => {
  if (!playing || seeking) return currentTimeMs;
  const elapsed = performance.now() - lastSyncAt;
  return Math.min(currentTimeMs + elapsed * speed, totalDurationMs);
};

/** 获取总时长（毫秒） */
export const getDuration = (): number => totalDurationMs;

/** 是否正在播放 */
export const isPlaying = (): boolean => playing;

/**
 * 同步主进程推送的位置
 *
 * 默认对小幅偏差应用单调防护：保留本地插值，仅刷新同步基准，
 * 避免 IPC 延迟 / 暂停瞬间晚到的事件导致进度与歌词跳变或回缩。
 *
 * @param ms 主进程推送的位置（毫秒）
 * @param options.force 强制采用 ms（如 load 重置、seek 跳转）
 * @returns 实际生效的位置
 */
export const setCurrentTime = (ms: number, options: { force?: boolean } = {}): number => {
  if (!options.force && !seeking && totalDurationMs > 0) {
    const interpolated = getCurrentTime();
    if (Math.abs(interpolated - ms) < SYNC_TOLERANCE_MS) {
      currentTimeMs = interpolated;
      lastSyncAt = performance.now();
      return interpolated;
    }
  }
  currentTimeMs = ms;
  lastSyncAt = performance.now();
  return ms;
};

/** 进入 seek 状态，冻结插值 */
export const setSeeking = (value: boolean): void => {
  seeking = value;
  if (!value) lastSyncAt = performance.now();
};

/** 同步时长 */
export const setDuration = (ms: number): void => {
  totalDurationMs = ms;
};

/** 同步播放状态 */
export const setPlaying = (value: boolean): void => {
  if (value === playing) return;
  // 暂停：冻结到当前可见位置
  if (!value) currentTimeMs = getCurrentTime();
  lastSyncAt = performance.now();
  playing = value;
};

/**
 * 同步播放速度
 * @param value - 播放速度
 *
 * 切速度瞬间，先按旧 speed 把可见位置推到 now，再切，避免视觉跳变
 */
export const setSpeed = (value: number): void => {
  if (value === speed) return;
  if (playing && !seeking) {
    currentTimeMs = getCurrentTime();
    lastSyncAt = performance.now();
  }
  speed = value;
};

/** 重置所有状态 */
export const reset = (): void => {
  currentTimeMs = 0;
  totalDurationMs = 0;
  lastSyncAt = 0;
  playing = false;
  seeking = false;
  speed = 1.0;
};
