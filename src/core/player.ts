import type { PlayerEvent, PlayerState, IpcResponse, Track } from "@shared/types/player";
import type { RepeatMode, ShuffleMode } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import * as queue from "@/stores/queue";
import * as playback from "@/services/playback";
import { loadAudio } from "@/services/audioLoader";

/**
 * 处理 IPC 返回结果，失败时写入 error
 * @param result - IPC 响应
 * @returns 是否成功
 */
const handleResult = (result: IpcResponse): boolean => {
  if (!result.success) {
    useStatusStore().error = result.error ?? "Unknown error";
    return false;
  }
  return true;
};

/**
 * 同步播放状态到非响应式时间源（供歌词等 60fps 动画使用）
 * @param state - 当前播放器状态
 */
const syncPlayback = (state: PlayerState): void => {
  playback.setPlaying(state === "playing");
  if (state === "idle") {
    playback.reset();
  }
};

/** 竞态 token：每次加载递增，异步返回后检查是否过期 */
let loadToken = 0;

/**
 * 加载音频源
 * @param source - 音频文件路径或网络地址
 * @param autoPlay - 是否自动播放，默认 true，false 时加载后暂停
 * @returns 加载成功返回 Track，失败返回 null
 */
export const load = async (source: string, autoPlay = true): Promise<Track | null> => {
  const status = useStatusStore();
  const token = ++loadToken;
  status.error = null;
  status.trackLoading = true;
  // 不提前重置 state 和 playback，保持当前封面/进度/播放状态
  // 等主进程返回后再更新，避免切歌时视觉跳变
  const wasPlaying = status.isPlaying;
  status.state = wasPlaying ? "playing" : "loading";
  try {
    const data = await loadAudio(source, autoPlay);
    // 竞态保护：如果已切歌，丢弃旧结果
    if (token !== loadToken) return null;
    if (data) {
      const media = useMediaStore();
      // 更新歌曲元信息 + 选择歌词源（同步）
      media.setTrack(data.track, data.detail);
      // 歌词后台加载，不阻塞播放
      media.loadLyric();
      // 更新播放状态和进度
      const dur = data.track.duration;
      status.duration = dur;
      status.position = 0;
      status.state = autoPlay ? "playing" : "paused";
      status.currentSource = source;
      // 同步到非响应式时间源
      playback.setDuration(dur);
      playback.setCurrentTime(0);
      playback.setPlaying(autoPlay);
      return data.track;
    } else {
      status.state = "idle";
      status.error = "Failed to load";
      return null;
    }
  } finally {
    if (token === loadToken) status.trackLoading = false;
  }
};

/**
 * 加载指定 Track 到播放器
 * 乐观更新：立即显示歌曲信息，快速切歌时只有最后一次 load 生效
 * @param track - 要播放的 Track，为 null 或无 path 时忽略
 */
const loadTrack = async (track: Track | null): Promise<void> => {
  if (!track?.path) return;
  // 乐观更新：同步写入 track，UI 立即响应
  useMediaStore().setTrack(track);
  await load(track.path);
};

/**
 * 加载单个音频源并添加到队列中播放
 * 已有同 ID 歌曲时跳转到该位置，否则插入到当前歌的下一位
 * @param source - 音频文件路径或网络地址
 */
export const addAndPlay = async (source: string): Promise<void> => {
  const track = await load(source);
  if (!track) return;
  const status = useStatusStore();
  // 检查队列中是否已有同 ID 的歌，有则跳转到该位置
  const existingIdx = queue.findTrackIndex(track.id);
  if (existingIdx !== -1) {
    status.playIndex = existingIdx;
    return;
  }
  // 插入到当前歌的下一位，而不是末尾
  const insertAt = status.playIndex + 1;
  queue.insertToQueue(track, insertAt);
  status.playIndex = insertAt;
};

/** 恢复播放 */
export const play = async (): Promise<void> => {
  const status = useStatusStore();
  const prev = status.state;
  status.state = "playing";
  playback.setPlaying(true);
  const result = await window.api.player.play();
  if (!handleResult(result)) {
    status.state = prev;
    playback.setPlaying(false);
  }
};

/** 暂停播放 */
export const pause = async (): Promise<void> => {
  const status = useStatusStore();
  const prev = status.state;
  status.state = "paused";
  playback.setPlaying(false);
  const result = await window.api.player.pause();
  if (!handleResult(result)) {
    status.state = prev;
    playback.setPlaying(true);
  }
};

/** 停止播放并重置进度 */
export const stop = async (): Promise<void> => {
  const result = await window.api.player.stop();
  if (handleResult(result)) {
    const status = useStatusStore();
    status.state = "stopped";
    status.position = 0;
    playback.reset();
  }
};

/**
 * seek 目标位置（毫秒），非 null 表示正在 seek，
 * 后端推送的 position 必须接近此值才会被接受
 */
let seekTarget: number | null = null;

/** 判断后端推送的 position 是否已到达 seek 目标附近 */
const hasReachedSeekTarget = (position: number): boolean => {
  if (seekTarget === null) return true;
  // 容差：后端推送的位置在 seek 目标 ±1s 内视为已到达
  if (Math.abs(position - seekTarget) < 1000) {
    seekTarget = null;
    return true;
  }
  return false;
};

/**
 * 跳转到指定播放位置
 * @param posMs - 目标位置（毫秒）
 */
export const seek = async (posMs: number): Promise<void> => {
  // 立即更新 UI，不等 IPC 返回
  const status = useStatusStore();
  status.position = posMs;
  playback.setCurrentTime(posMs);

  // 设置 seek 目标，屏蔽旧 position 推送
  seekTarget = posMs;

  const result = await window.api.player.seek(posMs);
  if (handleResult(result)) {
    status.position = posMs;
    playback.setCurrentTime(posMs);
  }
};

/**
 * 设置音量
 * @param vol - 音量值（0.0 ~ 1.0）
 */
export const setVolume = async (vol: number): Promise<void> => {
  const result = await window.api.player.setVolume(vol);
  if (handleResult(result)) {
    useStatusStore().volume = vol;
  }
};

/** 刷新音频输出设备列表 */
export const refreshDevices = async (): Promise<void> => {
  const result = await window.api.player.getOutputDevices();
  if (result.success && result.data) useStatusStore().outputDevices = result.data;
};

/**
 * 切换音频输出设备
 * @param deviceName - 设备名称，传 null 跟随系统默认
 */
export const switchDevice = async (deviceName: string | null): Promise<void> => {
  const result = await window.api.player.setOutputDevice(deviceName);
  if (handleResult(result)) useStatusStore().selectedDeviceName = deviceName;
};

/**
 * 设置队列并从指定位置开始播放
 * @param items - 歌曲列表
 * @param startIndex - 起始播放位置，默认 0
 */
export const playFrom = async (items: readonly Track[], startIndex = 0): Promise<void> => {
  if (items.length === 0) return;
  const status = useStatusStore();
  queue.setQueue(items);
  status.playIndex = Math.max(0, Math.min(startIndex, items.length - 1));
  // 随机模式下立即洗牌，当前歌置顶
  if (status.shuffleMode === "on") {
    queue.shuffleQueue(status.playIndex);
    status.playIndex = 0;
  }
  await loadTrack(status.currentTrack);
};

/** 播放下一首，队列末尾时根据循环模式决定行为 */
export const nextTrack = async (): Promise<void> => {
  const status = useStatusStore();
  if (queue.queueLength.value === 0) return;
  // 到末尾了
  if (status.playIndex >= queue.queueLength.value - 1) {
    // 列表循环 / 单曲循环：回到首位继续播放
    if (status.repeatMode === "list" || status.repeatMode === "one") {
      if (status.shuffleMode === "on") {
        queue.shuffleQueue(status.playIndex);
      }
      status.playIndex = 0;
    }
    // 非循环：队列播完
    else {
      await onQueueEnded();
      return;
    }
  } else {
    status.playIndex++;
  }
  await loadTrack(status.currentTrack);
};

/** 播放上一首，首位时回绕到末尾 */
export const prevTrack = async (): Promise<void> => {
  const status = useStatusStore();
  if (queue.queueLength.value === 0) return;
  status.playIndex = status.playIndex > 0 ? status.playIndex - 1 : queue.queueLength.value - 1;
  await loadTrack(status.currentTrack);
};

/** 队列播放结束，通知主进程停止并更新状态 */
const onQueueEnded = async (): Promise<void> => {
  playback.setPlaying(false);
  playback.reset();
  // 通知主进程停止音频引擎
  await window.api.player.stop();
  const status = useStatusStore();
  status.state = "stopped";
  status.position = status.duration;
};

/** 同步播放模式到主进程 */
const syncPlayMode = (): void => {
  const status = useStatusStore();
  window.api.player.syncPlayMode(status.repeatMode, status.shuffleMode);
};

/**
 * 设置循环模式
 * @param mode - off（不循环）、list（列表循环）、one（单曲循环）
 */
export const setRepeatMode = (mode: RepeatMode): void => {
  useStatusStore().repeatMode = mode;
  syncPlayMode();
};

/** 循环切换循环模式：list → one → off → list */
export const cycleRepeatMode = (): void => {
  const status = useStatusStore();
  const cycle: RepeatMode[] = ["list", "one", "off"];
  const nextIndex = (cycle.indexOf(status.repeatMode) + 1) % cycle.length;
  setRepeatMode(cycle[nextIndex]);
};

/** 切换随机模式 */
export const toggleShuffleMode = (): void => {
  const status = useStatusStore();
  setShuffleMode(status.shuffleMode === "on" ? "off" : "on");
};

/**
 * 设置随机模式，开启时洗牌队列，关闭时恢复原始顺序
 * @param mode - off（顺序）、on（随机）
 */
export const setShuffleMode = (mode: ShuffleMode): void => {
  const status = useStatusStore();
  if (status.shuffleMode === mode) return;
  status.shuffleMode = mode;
  if (mode === "on") {
    // 洗牌，当前歌置顶
    queue.shuffleQueue(status.playIndex);
    status.playIndex = 0;
  } else {
    // 恢复原始顺序，定位到当前歌在原始队列中的位置
    const track = status.currentTrack;
    if (track) {
      status.playIndex = queue.unshuffleQueue(track.id);
    } else {
      queue.unshuffleQueue("");
    }
  }
  syncPlayMode();
};

/**
 * 从队列移除指定位置的歌曲，自动调整 playIndex
 * @param index - 要移除的队列位置
 */
export const removeFromQueue = async (index: number): Promise<void> => {
  const status = useStatusStore();
  if (index < 0 || index >= queue.queueLength.value) return;
  const isCurrentPlaying = index === status.playIndex;
  queue.removeFromQueue(index);
  if (index < status.playIndex) {
    // 移除的在当前歌之前，索引前移
    status.playIndex--;
  } else if (isCurrentPlaying) {
    // 移除的就是当前歌
    if (queue.queueLength.value === 0) {
      status.playIndex = -1;
      await onQueueEnded();
      return;
    }
    // 索引越界则回到首位
    if (status.playIndex >= queue.queueLength.value) status.playIndex = 0;
    await loadTrack(status.currentTrack);
  }
};

/**
 * 插入歌曲到队列指定位置，自动调整 playIndex
 * @param item - 要插入的歌曲
 * @param afterIndex - 插入到此索引之后，默认为当前播放位置之后
 */
export const insertToQueue = (item: Track, afterIndex?: number): void => {
  const status = useStatusStore();
  // 确保插入位置合法，默认插在当前歌之后
  const insertAt = Math.max(0, afterIndex ?? status.playIndex + 1);
  queue.insertToQueue(item, insertAt);
  // 在当前歌之前或同位置插入，索引后移
  if (insertAt <= status.playIndex) status.playIndex++;
};

/**
 * 移动队列中的歌曲位置，自动调整 playIndex
 * @param fromIndex - 原位置
 * @param toIndex - 目标位置
 */
export const moveInQueue = (fromIndex: number, toIndex: number): void => {
  const status = useStatusStore();
  queue.moveInQueue(fromIndex, toIndex);
  // 根据移动方向调整 playIndex
  if (status.playIndex === fromIndex) {
    status.playIndex = toIndex;
  } else if (fromIndex < status.playIndex && toIndex >= status.playIndex) {
    status.playIndex--;
  } else if (fromIndex > status.playIndex && toIndex <= status.playIndex) {
    status.playIndex++;
  }
};

/** 防止 onTrackEnded 重入 */
let endedGuard = false;

/**
 * 处理主进程推送的播放事件
 * @param event - 播放事件
 */
const handleEvent = async (event: PlayerEvent): Promise<void> => {
  const status = useStatusStore();
  switch (event.type) {
    case "status":
      // 歌曲加载中或 loading 事件不更新 UI，保持当前封面/进度/播放状态平滑过渡
      if (event.data.state === "loading" || status.trackLoading) break;
      status.state = event.data.state;
      // seek 后只接受到达目标附近的 position，丢弃旧位置
      if (hasReachedSeekTarget(event.data.position)) {
        status.position = event.data.position;
        playback.setCurrentTime(event.data.position);
      }
      status.duration = event.data.duration;
      status.volume = event.data.volume;
      playback.setDuration(event.data.duration);
      syncPlayback(event.data.state);
      break;
    case "position":
      // 歌曲加载中不更新进度
      if (status.trackLoading) break;
      // seek 后丢弃旧位置，直到后端推送的位置到达 seek 目标附近
      if (!hasReachedSeekTarget(event.data.position)) break;
      status.position = event.data.position;
      playback.setCurrentTime(event.data.position);
      if (event.data.duration > 0) {
        status.duration = event.data.duration;
        playback.setDuration(event.data.duration);
      }
      // 同步歌词行索引
      useMediaStore().updateLyricIndex(event.data.position);
      break;
    case "ended": {
      if (endedGuard) return;
      endedGuard = true;
      try {
        // 单曲循环：seek 回开头继续播放（复用 FFmpeg 上下文，不重建）
        if (status.repeatMode === "one") {
          await seek(0);
          await play();
        } else {
          await nextTrack();
        }
      } finally {
        endedGuard = false;
      }
      break;
    }
    case "play":
      await play();
      break;
    case "pause":
      await pause();
      break;
    case "next":
      await nextTrack();
      break;
    case "prev":
      await prevTrack();
      break;
    case "setShuffle":
      setShuffleMode(event.data.mode);
      break;
    case "setRepeat":
      setRepeatMode(event.data.mode);
      break;
    case "error":
      status.error = event.error;
      break;
    case "deviceChanged":
      refreshDevices();
      break;
  }
};

let unsubscribe: (() => void) | null = null;
let initialized = false;

/** 初始化播放器：恢复队列、加载上次歌曲（含歌词）、seek 到上次位置、暂停等待 */
export const initPlayer = async (): Promise<void> => {
  if (initialized) return;
  initialized = true;
  console.log("[player] init");
  await queue.restoreQueue();
  const status = useStatusStore();
  // 恢复上次的音量和播放模式到主进程
  await window.api.player.setVolume(status.volume);
  syncPlayMode();
  // 恢复上次的歌曲：load 获取元数据和歌词，不自动播放
  const lastTrack = status.currentTrack;
  if (lastTrack?.path) {
    const lastPosition = status.position;
    // autoPlay=false，主进程 load 后立即暂停，不会有声音
    await load(lastTrack.path, false);
    // seek 到上次位置
    if (lastPosition > 0) {
      await seek(lastPosition);
    }
  } else {
    status.state = "idle";
  }
  if (unsubscribe) unsubscribe();
  unsubscribe = window.api.player.onEvent(handleEvent);
};

/** 清理事件订阅 */
export const disposePlayer = (): void => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
};
