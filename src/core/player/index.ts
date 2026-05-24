import type { Track } from "@shared/types/player";
import { handleEvent } from "./events";
import type { RepeatMode, ShuffleMode } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { useStreamingStore } from "@/stores/streaming";
import { usePluginsStore } from "@/stores/plugins";
import { useHistoryStore } from "@/stores/history";
import * as queue from "@/stores/queue";
import * as fm from "./fm";
import * as playback from "@/services/playback";
import * as lyricLoader from "@/services/lyricLoader";
import * as abLoop from "@/services/abLoop";
import * as cacheScheduler from "@/services/cacheScheduler";
import { resolveTrackSource } from "@/services/audioSource";
import { installPlayStats } from "./stats";
import { extractColorFromUrl } from "@/utils/color";
import { handleError, isSkippableError } from "@/utils/errors";

/** 引擎 load 竞态 token */
let loadToken = 0;
/** loadTrack 竞态 token */
let trackToken = 0;
/** 连续加载失败计数，成功时重置 */
let consecutiveFailures = 0;
/** 连续失败硬上限 */
const MAX_CONSECUTIVE_FAILURES = 5;
/** 失败后跳下一首的节流延迟（毫秒） */
const SKIP_ON_ERROR_DELAY_MS = 1000;

/**
 * 单曲级失败兜底
 * 达到连续失败上限 / 队列长度则交 onQueueEnded 停下
 * @param myToken - 调用方进入失败路径时的 token 快照
 * @param getCurrentToken - 取该 token 的最新值，setTimeout 触发时再次比对
 */
const skipOnFailure = async (myToken: number, getCurrentToken: () => number): Promise<void> => {
  consecutiveFailures++;
  if (
    consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ||
    consecutiveFailures >= queue.queueLength.value
  ) {
    consecutiveFailures = 0;
    await onQueueEnded();
    return;
  }
  setTimeout(() => {
    if (myToken === getCurrentToken()) nextTrack();
  }, SKIP_ON_ERROR_DELAY_MS);
};

/** load() 的结果；失败时附带错误码，跳曲决策交给调用方 */
export type LoadOutcome = { ok: true; track: Track | null } | { ok: false; error?: string };

/**
 * 切歌通用前置
 * @param duration 新歌时长（毫秒），未知时传 0
 */
const resetForLoad = (duration: number): void => {
  const status = useStatusStore();
  status.trackLoading = true;
  status.position = 0;
  status.duration = duration;
  playback.setCurrentTime(0, { force: true });
  playback.setDuration(duration);
  playback.setPlaying(false);
  // 上一首未达到缓存触发阈值的请求丢弃
  cacheScheduler.cancel();
};

/**
 * 加载音频源
 * @param source - 音频文件路径或网络地址
 * @param autoPlay - 是否自动播放
 * @param meta - 渲染层下发给主进程的权威 Track（用于 SMTC/托盘）
 */
export const load = async (source: string, autoPlay = true, meta?: Track): Promise<LoadOutcome> => {
  const status = useStatusStore();
  const token = ++loadToken;
  // 切歌即清空 AB 循环（per-song 状态）
  abLoop.reset();
  // 清除上一次 seek 残留
  seekTarget = null;
  playback.setSeeking(false);
  resetForLoad(meta?.duration ?? 0);
  // 非本地并行歌词与取色
  const isOnline = meta?.source !== "local";
  if (isOnline) {
    void lyricLoader.loadForTrack(null);
    extractColorFromUrl(meta?.coverOriginal ?? meta?.cover ?? null);
  }
  try {
    const result = await window.api.player.load(source, { autoPlay, meta });
    // 竞态保护
    if (token !== loadToken) return { ok: false };
    if (result.success && result.data) {
      const { detail, mediaInfo } = result.data;
      consecutiveFailures = 0;
      const media = useMediaStore();
      // 把引擎提取的 mediaInfo 与已有 Track 合并；身份字段保留
      media.enrichTrack(mediaInfo, detail);
      const enriched = media.track;
      // 避免重复请求
      if (!isOnline) {
        lyricLoader.loadForTrack(detail);
        extractColorFromUrl(enriched?.cover ?? null);
      }
      const dur = enriched?.duration ?? mediaInfo.duration;
      status.duration = dur;
      status.state = autoPlay ? "playing" : "paused";
      status.currentSource = source;
      playback.setDuration(dur);
      playback.setPlaying(autoPlay);
      return { ok: true, track: enriched };
    }
    status.state = "idle";
    lyricLoader.loadForTrack(null);
    if (result.error) handleError(result.error);
    return { ok: false, error: result.error };
  } finally {
    if (token === loadToken) status.trackLoading = false;
  }
};

/**
 * 加载指定 Track 到播放器
 * 乐观更新：立即显示歌曲信息，快速切歌时只有最后一次 load 生效
 * @param track - 要播放的 Track，为 null 时忽略
 */
const loadTrack = async (track: Track | null): Promise<void> => {
  if (!track) return;
  const myToken = ++trackToken;
  // 乐观更新
  useMediaStore().setTrack(track);
  lyricLoader.beginLoad();
  resetForLoad(track.duration ?? 0);
  void window.api.player.stop();
  // 解析 URL
  const resolved = await resolveTrackSource(track);
  // 期间有新点击，让位给最新的 loadTrack
  if (myToken !== trackToken) return;
  // 是否可跳曲
  let shouldSkip = false;
  // URL 解析失败
  if (!resolved) {
    const status = useStatusStore();
    status.currentSource = null;
    status.state = "idle";
    void window.api.player.stop();
    useMediaStore().setLyric(null, null);
    shouldSkip = true;
  } else {
    const result = await load(resolved.source, true, track);
    if (myToken !== trackToken) return;
    // 引擎失败且属单曲级错误才跳
    if (!result.ok && result.error && isSkippableError(result.error)) {
      shouldSkip = true;
    } else if (result.ok) {
      // 用户主动触发的成功播放记入历史；initPlayer 的恢复路径走 load() 不经此处
      void useHistoryStore().record(track);
      if (resolved.cacheRequest) {
        cacheScheduler.schedule(track.id, resolved.cacheRequest);
      }
    }
  }
  if (shouldSkip) await skipOnFailure(myToken, () => trackToken);
};

/**
 * 热替换当前播放
 * 切换在线音质、或在线 URL 过期时调用：重新解析 URL 并从当前进度续播
 * @param forcePlay - 重载后强制播放
 */
export const reloadCurrentTrack = async (forcePlay?: boolean): Promise<void> => {
  const media = useMediaStore();
  const track = media.track;
  if (!track || track.source !== "netease") return;
  const status = useStatusStore();
  const shouldPlay = forcePlay ?? status.isPlaying;
  const resumePosition = Math.round(playback.getCurrentTime());
  // 抢占加载令牌，与 loadTrack 互相取消
  const myToken = ++trackToken;
  // resolveTrackSource 联网解析较慢，先置加载态，让播放键立即给出反馈
  status.trackLoading = true;
  const resolved = await resolveTrackSource(track);
  if (myToken !== trackToken) return;
  // 解析失败：保留当前播放，不打断
  if (!resolved) {
    status.trackLoading = false;
    return;
  }
  // 以暂停态加载，seek 回原进度后再决定是否播放，避免从 0 漏音
  const result = await load(resolved.source, false, track);
  if (myToken !== trackToken || !result.ok) return;
  if (resumePosition > 0) await seek(resumePosition);
  if (shouldPlay) await play();
  if (resolved.cacheRequest) {
    cacheScheduler.schedule(track.id, resolved.cacheRequest);
  }
};

/** 同一首歌因源失效连续重载的次数，换歌时归零 */
let sourceRecoveryCount = 0;
/** sourceRecoveryCount 对应的 track id */
let sourceRecoveryTrackId: string | null = null;

/**
 * 源失效恢复
 * 重载一次后仍失败则放弃跳曲
 */
export const recoverFromSourceFailure = async (): Promise<void> => {
  const track = useMediaStore().track;
  if (!track) return;
  if (sourceRecoveryTrackId !== track.id) {
    sourceRecoveryTrackId = track.id;
    sourceRecoveryCount = 0;
  }
  // 最多重载一次
  if (sourceRecoveryCount >= 1) {
    sourceRecoveryCount = 0;
    await nextTrack();
    return;
  }
  sourceRecoveryCount++;
  await reloadCurrentTrack(true);
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

/**
 * 判断后端推送的 position 是否已到达 seek 目标附近
 * @param position - 后端推送的播放位置（毫秒）
 * @returns 是否已到达 seek 目标
 */
export const hasReachedSeekTarget = (position: number): boolean => {
  if (seekTarget === null) return true;
  // 容差：后端推送的位置在 seek 目标 ±1s 内视为已到达
  if (Math.abs(position - seekTarget) < 1000) {
    seekTarget = null;
    playback.setSeeking(false);
    return true;
  }
  return false;
};

/** 当前是否正在 seek */
export const isSeeking = (): boolean => seekTarget !== null;

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
  // 退出特殊模式
  status.heartMode = false;
  status.fmMode = false;
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

/**
 * 进入心动模式：用智能推荐列表替换队列并从头播放
 * @param tracks - 网易云智能推荐曲目
 */
export const playHeartMode = async (tracks: readonly Track[]): Promise<void> => {
  if (tracks.length === 0) return;
  const status = useStatusStore();
  queue.setQueue(tracks);
  status.playIndex = 0;
  status.shuffleMode = "off";
  status.heartMode = true;
  // 心动 / FM 互斥
  status.fmMode = false;
  syncPlayMode();
  await loadTrack(status.currentTrack);
};

/** 退出心动模式，保留当前队列继续播放 */
export const exitHeartMode = (): void => {
  useStatusStore().heartMode = false;
};

/** 进入私人 FM */
export const playPersonalFm = async (): Promise<boolean> => {
  const status = useStatusStore();
  const track = await fm.start();
  if (!track) return false;
  status.fmMode = true;
  // 心动 / FM 互斥
  status.heartMode = false;
  await loadTrack(track);
  return true;
};

/** 私人 FM 减少推荐 */
export const dislikeFmTrack = async (): Promise<void> => {
  if (!useStatusStore().fmMode) return;
  const next = await fm.dislikeCurrent();
  if (next) await loadTrack(next);
};

/** 播放下一首，队列末尾时根据循环模式决定行为 */
export const nextTrack = async (): Promise<void> => {
  const status = useStatusStore();
  // 私人 FM
  if (status.fmMode) {
    const next = await fm.next();
    if (next) await loadTrack(next);
    return;
  }
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

/**
 * 跳到队列指定位置并播放
 * 同一首则不重新加载，仅在暂停时恢复播放
 * @param index - 队列位置
 */
export const playAtIndex = async (index: number): Promise<void> => {
  const status = useStatusStore();
  if (index < 0 || index >= queue.queueLength.value) return;
  if (index === status.playIndex) {
    if (!status.isPlaying && useMediaStore().track) play();
    return;
  }
  // 退出 FM
  status.fmMode = false;
  status.playIndex = index;
  await loadTrack(status.currentTrack);
};

/** 播放上一首，首位时回绕到末尾 */
export const prevTrack = async (): Promise<void> => {
  const status = useStatusStore();
  if (status.fmMode) return;
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
  // 心动模式下忽略
  if (status.heartMode) return;
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
 * 批量插入曲目到当前曲目之后，一次性切片落盘，避免逐首插入的卡顿
 * 跳过队列中已存在的（含当前播放曲目）与传入列表内部的重复
 * @param items - 要插入的曲目
 * @returns 实际插入的数量
 */
export const insertManyToQueue = (items: readonly Track[]): number => {
  if (items.length === 0) return 0;
  const status = useStatusStore();
  const seen = new Set(queue.queue.value.map((track) => track.id));
  const fresh: Track[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    fresh.push(item);
  }
  if (fresh.length === 0) return 0;
  queue.insertManyToQueue(fresh, status.playIndex + 1);
  return fresh.length;
};

/**
 * 插入歌曲到当前位置之后并立即播放
 * 如果是当前正在播放的歌曲则继续播放，不重新加载
 */
export const playNow = async (item: Track): Promise<void> => {
  const status = useStatusStore();
  const media = useMediaStore();
  // 同一首歌且已成功加载
  if (media.track?.id === item.id && status.currentSource) {
    if (!status.isPlaying) play();
    return;
  }
  // 退出 FM
  status.fmMode = false;
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

let unsubscribe: (() => void) | null = null;
let initialized = false;

/** 初始化播放器 */
export const initPlayer = async (): Promise<void> => {
  if (initialized) return;
  initialized = true;
  console.log("[player] init");
  // 先从主进程同步后端配置，确保 system 设置可用
  const settings = useSettingsStore();
  await settings.syncSystem();
  // 流媒体 store 必须在恢复队列前就绪，否则队列里的 streaming track 拿不到 cfg
  await useStreamingStore().init();
  // 插件 store 同理：在线歌曲 URL 兜底走插件，列表必须在 loadTrack 前就绪
  void usePluginsStore().load();
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
  // 应用均衡器配置
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
  // 安装播放统计累加器
  installPlayStats();
  // 订阅主进程下发的歌词偏移变化
  const media = useMediaStore();
  window.api.nowPlaying.onLyricOffsetChange(({ offsetMs }) => {
    status.lyricOffsetMs = offsetMs;
    media.updateLyricIndex(playback.getCurrentTime() + offsetMs);
  });
  // 获取歌曲偏移
  try {
    const snap = await window.api.nowPlaying.requestSnapshot();
    status.lyricOffsetMs = snap.lyricOffsetMs;
  } catch (error) {
    console.error("[player] requestSnapshot failed", error);
  }
  const lastTrack = status.currentTrack;
  if (lastTrack) {
    const lastPosition = status.position;
    useMediaStore().setTrack(lastTrack);
    const resolved = await resolveTrackSource(lastTrack);
    if (resolved) {
      lyricLoader.beginLoad();
      const result = await load(resolved.source, settings.system.player.autoPlay, lastTrack);
      if (result.ok && settings.system.player.rememberLastTrack && lastPosition > 0) {
        await seek(lastPosition);
      }
      if (result.ok && resolved.cacheRequest) {
        cacheScheduler.schedule(lastTrack.id, resolved.cacheRequest);
      }
    } else {
      status.state = "idle";
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
