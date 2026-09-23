/**
 * 听歌识曲会话：持有原生采集会话，驱动 采集 → 指纹 → 匹配 → 结果 的状态机，
 * 并通过 recognition:event 广播进度
 */

import { loadNativeModule } from "@main/utils/nativeLoader";
import { broadcast } from "@main/utils/broadcast";
import { getPlayer } from "@main/services/engine";
import { recognitionLog } from "@main/utils/logger";
import type { JsCaptureEvent } from "@splayer/audio-capture";
import { matchAudio } from "./match";
import { fingerprintPcm, isAfpAvailable } from "./fingerprint";
import type {
  RecognitionCandidate,
  RecognitionConfig,
  RecognitionErrorCode,
  RecognitionEvent,
} from "@shared/types/recognition";

type AudioCaptureModule = typeof import("@splayer/audio-capture");
type CaptureSessionInstance = InstanceType<AudioCaptureModule["AudioCaptureSession"]>;

/** 静音判定阈值（8 kHz 单声道 RMS） */
const SILENCE_RMS_THRESHOLD = 0.005;
/** 匹配窗口：3 秒窗口、1 秒步长滑动，8 秒样本最多 6 个窗口 */
const WINDOW_SAMPLES = 3 * 8000;
const STEP_SAMPLES = 1 * 8000;

let audioCapture: AudioCaptureModule | null = null;

/** 惰性加载 audio-capture 原生模块 */
const getAudioCapture = (): AudioCaptureModule | null => {
  if (audioCapture) return audioCapture;
  audioCapture = loadNativeModule<AudioCaptureModule>("audio-capture.node", "audio-capture");
  return audioCapture;
};

/** 当前原生采集会话 */
let activeSession: CaptureSessionInstance | null = null;
/** 采集系统声音前是否正在播放，结束后恢复 */
let wasPlaying = false;
/** 会话令牌：start / submit / cancel 时递增，指纹与匹配步骤据此识别取消 */
let sessionToken = 0;

/** 推送识别事件；level 属于高频事件，仅在窗口可见时广播 */
const emit = (event: RecognitionEvent): void => {
  broadcast("recognition:event", event, event.phase === "capturing");
};

/** 将原生错误码映射为共享错误码 */
const mapErrorCode = (code?: string): RecognitionErrorCode => {
  switch (code) {
    case "unsupported":
      return "unsupported";
    case "no-device":
      return "no-device";
    case "permission-denied":
      return "permission-denied";
    case "capture-failed":
      return "capture-failed";
    default:
      return "unknown";
  }
};

/** 8 kHz 单声道样本的 RMS 音量 */
const rms = (pcm: Float32Array): number => {
  let energy = 0;
  for (let i = 0; i < pcm.length; i++) {
    energy += pcm[i] * pcm[i];
  }
  return Math.sqrt(energy / Math.max(1, pcm.length));
};

/** 指纹输入的期望 RMS：低音量回采经增益补偿后接近该值 */
const TARGET_RMS = 0.1;
/** 增益上限，避免把近静音放大成噪声指纹 */
const MAX_GAIN = 50;

/**
 * 音量归一化：系统音量过低时回采信号很弱，AFP 峰值拾取几乎找不到特征，
 * 导致识别率低。仅在信号偏弱时放大到目标 RMS，过强时保持原样
 * @param pcm - 8 kHz 单声道样本
 * @returns 归一化后的样本
 */
const normalizeLevel = (pcm: Float32Array): Float32Array => {
  const current = rms(pcm);
  if (current <= 0) return pcm;
  const gain = Math.min(MAX_GAIN, TARGET_RMS / current);
  if (gain <= 1) return pcm;
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = pcm[i] * gain;
  }
  return out;
};

/** 结束会话并恢复播放 */
const finishSession = (): void => {
  activeSession = null;
  if (wasPlaying) {
    wasPlaying = false;
    getPlayer()
      .play()
      .catch((error) => recognitionLog.error("恢复播放失败:", error));
  }
};

const emitError = (code: RecognitionErrorCode, message: string): void => {
  recognitionLog.warn(`识别失败 [${code}]: ${message}`);
  emit({ phase: "error", error: { code, message } });
  finishSession();
};

/**
 * 开始一次识别
 * @param config - 采集来源与时长
 */
export const startRecognition = (config: RecognitionConfig): void => {
  cancelRecognition();
  const mod = getAudioCapture();
  if (!mod || !mod.AudioCaptureSession) {
    emitError("unsupported", "当前环境不支持本机采集");
    return;
  }
  const inst = new mod.AudioCaptureSession();
  if (!inst.isSupported()) {
    emitError("unsupported", "当前平台不支持本机采集");
    return;
  }
  if (!isAfpAvailable()) {
    emitError("afp-unavailable", "音频指纹库不可用");
    return;
  }

  // 采集前暂停自身播放，结束后恢复
  wasPlaying = getPlayer().getStatus().state === "playing";
  if (wasPlaying) getPlayer().pause();

  activeSession = inst;
  sessionToken++;
  emit({ phase: "capturing" });
  try {
    inst.start(
      { source: config.source, durationMs: config.durationMs },
      (event: JsCaptureEvent) => {
        void handleCaptureEvent(event);
      },
    );
  } catch (error) {
    emitError("capture-failed", error instanceof Error ? error.message : String(error));
  }
};

/** 处理原生采集事件 */
const handleCaptureEvent = async (event: JsCaptureEvent): Promise<void> => {
  if (event.eventType === "level") {
    emit({ phase: "capturing", level: event.level ?? 0 });
    return;
  }
  if (event.eventType === "error") {
    emitError(mapErrorCode(event.errorCode), event.error ?? "未知采集错误");
    return;
  }
  // done
  if (!event.data) {
    // 取消或异常结束，无数据
    finishSession();
    return;
  }
  const pcm = new Float32Array(event.data.buffer, event.data.byteOffset, event.data.length / 4);
  void recognizePcm(pcm);
};

/**
 * 识别一段 8 kHz 单声道 PCM：按 3 秒窗口 / 1 秒步长滑动，顺序匹配，首个有候选的窗口即停止
 * 供原生采集 done 事件与渲染进程麦克风提交共用
 * @param pcm - 8 kHz 单声道样本
 */
const recognizePcm = async (pcm: Float32Array): Promise<void> => {
  const token = sessionToken;
  const normalized = normalizeLevel(pcm);
  if (rms(normalized) < SILENCE_RMS_THRESHOLD) {
    emitError("silent-input", "没有采集到声音，请检查音频输出");
    return;
  }
  emit({ phase: "fingerprinting" });
  const windows: Array<{ start: number; pcm: Float32Array }> = [];
  for (let start = 0; start + WINDOW_SAMPLES <= normalized.length; start += STEP_SAMPLES) {
    windows.push({ start, pcm: normalized.subarray(start, start + WINDOW_SAMPLES) });
  }
  if (windows.length === 0) {
    windows.push({ start: 0, pcm: normalized });
  }
  let candidates: RecognitionCandidate[] = [];
  for (const window of windows) {
    if (token !== sessionToken) return;
    const fingerprint = await fingerprintPcm(window.pcm);
    if (token !== sessionToken) return;
    if (!fingerprint.ok) {
      emitError(
        fingerprint.error === "afp-unavailable" ? "afp-unavailable" : "unknown",
        fingerprint.error,
      );
      return;
    }
    emit({ phase: "matching" });
    const match = await matchAudio(fingerprint.fingerprint, WINDOW_SAMPLES / 8000);
    if (token !== sessionToken) return;
    if (!match.ok) {
      emitError("network", "音频匹配服务不可用");
      return;
    }
    if (match.songs.length === 0) continue;
    candidates = match.songs.map((item) => ({
      songId: String(item.song.id),
      title: item.song.name,
      artists: (item.song.artists ?? []).map((artist) => artist.name),
      album: item.song.album?.name,
      cover: item.song.album?.picUrl,
      startTime: (item.startTime ?? 0) + window.start / 8000,
    }));
    break;
  }
  recognitionLog.info(`识别完成，候选 ${candidates.length} 个`);
  emit({ phase: "done", candidates });
  finishSession();
};

/**
 * 渲染进程麦克风路径：接收 AudioWorklet 采集的 8 kHz PCM 后执行识别
 * @param pcm - 8 kHz 单声道样本
 */
export const submitPcm = (pcm: Float32Array): void => {
  if (!(pcm instanceof Float32Array) || pcm.length === 0) {
    emitError("capture-failed", "渲染进程提交了无效的 PCM");
    return;
  }
  if (!isAfpAvailable()) {
    emitError("afp-unavailable", "音频指纹库不可用");
    return;
  }
  sessionToken++;
  emit({ phase: "capturing" });
  void recognizePcm(pcm);
};

/**
 * 取消当前识别
 */
export const cancelRecognition = (): void => {
  sessionToken++;
  activeSession?.cancel();
  finishSession();
};

/**
 * 当前平台是否支持听歌识曲
 */
export const isRecognitionSupported = (): boolean => {
  const mod = getAudioCapture();
  if (!mod || !mod.AudioCaptureSession) return false;
  return new mod.AudioCaptureSession().isSupported();
};
