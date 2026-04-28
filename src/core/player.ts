import type { PlayerEvent, Track } from "@shared/types/player";
import type { RepeatMode, ShuffleMode } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import * as queue from "@/stores/queue";
import * as playback from "@/services/playback";
import * as lyricLoader from "@/services/lyricLoader";
import { loadAudio } from "@/services/audioLoader";
import { extractColorFromUrl } from "@/utils/color";
import { handleError, isSkippableError } from "@/utils/errors";

/** 竞态 token */
let loadToken = 0;
/** 连续加载失败计数，成功时重置 */
let consecutiveFailures = 0;
/** 连续失败硬上限 */
const MAX_CONSECUTIVE_FAILURES = 5;
/** 失败后跳下一首的节流延迟（毫秒） */
const SKIP_ON_ERROR_DELAY_MS = 1000;

/**
 * 加载音频源
 * @param source - 音频文件路径或网络地址
 * @param autoPlay - 是否自动播放，默认 true，false 时加载后暂停
 * @returns 加载成功返回 Track，失败返回 null
 */
export const load = async (source: string, autoPlay = true): Promise<Track | null> => {
  const status = useStatusStore();
  const token = ++loadToken;
  status.trackLoading = true;
  // 清除上一次 seek 残留
  seekTarget = null;
  playback.setSeeking(false);
  // 不提前重置，保持播放状态
  const wasPlaying = status.isPlaying;
  status.state = wasPlaying ? "playing" : "loading";
  try {
    const { data, error } = await loadAudio(source, autoPlay);
    // 竞态保护
    if (token !== loadToken) return null;
    if (data) {
      consecutiveFailures = 0;
      const media = useMediaStore();
      media.setTrack(data.track, data.detail);
      lyricLoader.loadForTrack(data.detail);
      extractColorFromUrl(data.track.cover ?? null);
      const dur = data.track.duration;
      status.duration = dur;
      status.position = 0;
      status.state = autoPlay ? "playing" : "paused";
      status.currentSource = source;
      playback.setDuration(dur);
      playback.setCurrentTime(0, { force: true });
      playback.setPlaying(autoPlay);
      return data.track;
    } else {
      status.state = "idle";
      lyricLoader.loadForTrack(null);
      if (error) {
        handleError(error);
        // 仅单曲级错误才跳下一首（设备等全局错误跳了也没用）
        if (isSkippableError(error)) {
          consecutiveFailures++;
          const reachedHardLimit = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
          const reachedQueueEnd = consecutiveFailures >= queue.queueLength.value;
          if (reachedHardLimit || reachedQueueEnd) {
            // 达到上限，停止自动跳曲，等待用户介入
            consecutiveFailures = 0;
            await onQueueEnded();
          } else {
            // 节流：给主进程/文件系统喘息时间，也避免日志刷屏
            setTimeout(() => {
              // 期间用户可能已手动操作，token 变化则放弃
              if (token === loadToken) nextTrack();
            }, SKIP_ON_ERROR_DELAY_MS);
          }
        }
      }
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
  // 乐观更新：同步写入 track，开启歌词加载周期
  useMediaStore().setTrack(track);
  lyricLoader.beginLoad();
  await load(track.path);
};

/** 恢复播放 */
export const play = async (): Promise<void> => {
  const status = useStatusStore();
  const prev = status.state;
  status.state = "playing";
  playback.setPlaying(true);
  const result = await window.api.player.play();
  if (!result.success) {
    status.state = prev;
    playback.setPlaying(false);
    handleError(result.error ?? "UNKNOWN");
  }
};

/** 切换播放/暂停 */
export const togglePlay = (): void => {
  const status = useStatusStore();
  if (status.isPlaying) {
    pause();
  } else {
    play();
  }
};

/** 暂停播放 */
export const pause = async (): Promise<void> => {
  const status = useStatusStore();
  const prev = status.state;
  status.state = "paused";
  playback.setPlaying(false);
  const result = await window.api.player.pause();
  if (!result.success) {
    status.state = prev;
    playback.setPlaying(true);
  }
};

/** 停止播放并重置进度 */
export const stop = async (): Promise<void> => {
  const result = await window.api.player.stop();
  if (result.success) {
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
    playback.setSeeking(false);
    return true;
  }
  return false;
};

/**
 * 跳转到指定播放位置
 * @param posMs - 目标位置（毫秒）
 */
export const seek = async (posMs: number): Promise<void> => {
  const status = useStatusStore();
  // 先冻结插值，再写入位置
  playback.setSeeking(true);
  status.position = posMs;
  playback.setCurrentTime(posMs);

  // 设置 seek 目标，屏蔽旧 position 推送
  seekTarget = posMs;

  const result = await window.api.player.seek(posMs);
  if (result.success) {
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
  if (result.success) {
    useStatusStore().volume = vol;
  }
};

/**
 * 设置播放速度
 * @param v - 速度（0.5 ~ 2.0）
 */
export const setSpeed = async (v: number): Promise<void> => {
  const safe = Number.isFinite(v) ? Math.max(0.5, Math.min(2.0, v)) : 1.0;
  const result = await window.api.player.setSpeed(safe);
  if (result.success) {
    useStatusStore().speed = safe;
    // 同步给 playback 时间源，让墙钟插值正确换算到源时间
    playback.setSpeed(safe);
  }
};

/**
 * 设置音调偏移（半音 -12 ~ 12）
 */
export const setPitch = async (n: number): Promise<void> => {
  const safe = Number.isFinite(n) ? Math.max(-12, Math.min(12, Math.round(n))) : 0;
  const result = await window.api.player.setPitch(safe);
  if (result.success) useStatusStore().pitch = safe;
};

/**
 * 设置"音调同步"开关
 * @param on - true = 变速保音调，false = 变速变调
 */
export const setPitchSync = async (on: boolean): Promise<void> => {
  const result = await window.api.player.setPitchSync(on);
  if (result.success) useStatusStore().pitchSync = on;
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
  if (result.success) useSettingsStore().player.outputDevice = deviceName;
};

/**
 * 设置队列并从指定位置开始播放
 * @param items - 歌曲列表
 * @param startIndex - 起始播放位置，默认 0
 */
export const playFrom = async (items: readonly Track[], startIndex = 0): Promise<void> => {
  if (items.length === 0) return;
  const status = useStatusStore();
  const media = useMediaStore();
  const idx = Math.max(0, Math.min(startIndex, items.length - 1));
  const isSameTrack = media.track?.id === items[idx]?.id;
  queue.setQueue(items);
  status.playIndex = idx;
  if (status.shuffleMode === "on") {
    queue.shuffleQueue(status.playIndex);
    status.playIndex = 0;
  }
  if (isSameTrack) {
    if (!status.isPlaying) play();
  } else {
    await loadTrack(status.currentTrack);
  }
};

/** 播放下一首，队列末尾时根据循环模式决定行为 */
export const nextTrack = async (): Promise<void> => {
  const status = useStatusStore();
  if (queue.queueLength.value === 0) return;
  // 到末尾了
  if (status.playIndex >= queue.queueLength.value - 1) {
    // 列表循环 / 单曲循环：回到首位继续播放
    if (status.repeatMode === "list" || status.repeatMode === "one") {
      if (status.shuffleMode === "on" && queue.queueLength.value > 1) {
        // 重新洗牌产生新顺序，当前歌在 index 0，从 1 开始避免重复
        queue.shuffleQueue(status.playIndex);
        status.playIndex = 1;
      } else {
        status.playIndex = 0;
      }
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
 * 队列中已有同 ID 歌曲时移动到目标位置
 * @param item - 要插入的歌曲
 * @param afterIndex - 插入到此索引之后，默认为当前播放位置之后
 * @returns 歌曲在队列中的实际索引
 */
export const insertToQueue = (item: Track, afterIndex?: number): number => {
  const status = useStatusStore();
  const len = queue.queue.value.length;
  const raw = afterIndex ?? status.playIndex + 1;
  const existingIdx = queue.findTrackIndex(item.id);
  if (existingIdx !== -1) {
    // 移动：目标需 clamp 到 length-1
    const safeAt = Math.max(0, Math.min(raw, len - 1));
    if (existingIdx === safeAt) return existingIdx;
    moveInQueue(existingIdx, safeAt);
    return safeAt;
  }
  // 插入：可以追加到末尾，clamp 到 length
  const safeAt = Math.max(0, Math.min(raw, len));
  queue.insertToQueue(item, safeAt);
  if (safeAt <= status.playIndex) status.playIndex++;
  return safeAt;
};

/**
 * 插入歌曲到当前位置之后并立即播放
 * 如果是当前正在播放的歌曲则继续播放，不重新加载
 */
export const playNow = async (item: Track): Promise<void> => {
  const status = useStatusStore();
  const media = useMediaStore();
  if (media.track?.id === item.id) {
    if (!status.isPlaying) play();
    return;
  }
  status.playIndex = insertToQueue(item);
  await loadTrack(item);
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
      // seek 期间不从 status 事件更新 position，避免回跳
      // position 的更新统一由 position 事件负责
      if (seekTarget === null) {
        status.position = playback.setCurrentTime(event.data.position);
      }
      status.duration = event.data.duration;
      status.volume = event.data.volume;
      playback.setDuration(event.data.duration);
      playback.setPlaying(event.data.state === "playing");
      break;
    case "position": {
      // 歌曲加载中不更新进度
      if (status.trackLoading) break;
      // seek 后丢弃旧位置，直到后端推送的位置到达 seek 目标附近
      if (!hasReachedSeekTarget(event.data.position)) break;
      const adjusted = playback.setCurrentTime(event.data.position);
      status.position = adjusted;
      if (event.data.duration > 0) {
        status.duration = event.data.duration;
        playback.setDuration(event.data.duration);
      }
      // 用修正后的位置同步歌词索引，避免与显示进度不一致
      useMediaStore().updateLyricIndex(adjusted);
      break;
    }
    case "fftData":
      status.fftData = event.data;
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
  // 先从主进程同步后端配置，确保 system 设置可用
  const settings = useSettingsStore();
  await settings.syncSystem();
  await queue.restoreQueue();
  const status = useStatusStore();
  // 恢复上次的音量和播放模式到主进程
  await window.api.player.setVolume(status.volume);
  syncPlayMode();
  // 应用渐入渐出配置
  const { fadeEnabled, fadeDuration, loudnessNormalization, equalizer } = settings.system.player;
  await window.api.player.setFadeDuration(fadeEnabled ? fadeDuration : 0);
  // 应用音量均衡配置
  await window.api.player.setNormalizationEnabled(loudnessNormalization ?? false);
  // 应用均衡器配置（频段/前级先下发，再切总开关，避免开关瞬间用旧值）
  // 注意：reactive 数组无法被 IPC structured-clone，需 spread 解包
  if (equalizer) {
    await window.api.player.setEqualizerBands([...equalizer.bands]);
    await window.api.player.setPreampGain(equalizer.preamp);
    await window.api.player.setEqualizerEnabled(equalizer.enabled);
  }
  // 刷新设备列表并恢复上次选择的输出设备
  await refreshDevices();
  if (settings.player.outputDevice) {
    await window.api.player.setOutputDevice(settings.player.outputDevice);
  }
  // 先订阅事件，确保 load 触发播放后 position 事件能被接收
  if (unsubscribe) unsubscribe();
  unsubscribe = window.api.player.onEvent(handleEvent);
  const lastTrack = status.currentTrack;
  if (lastTrack?.path) {
    const lastPosition = status.position;
    // 先设置 track 信息（确保播放条显示），再尝试 load
    useMediaStore().setTrack(lastTrack);
    lyricLoader.beginLoad();
    const result = await load(lastTrack.path, settings.system.player.autoPlay);
    // load 成功且需要恢复进度时 seek
    if (result && settings.system.player.rememberLastTrack && lastPosition > 0) {
      await seek(lastPosition);
    }
  } else {
    status.state = "idle";
  }
};

/** 清理事件订阅 */
export const disposePlayer = (): void => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
};
