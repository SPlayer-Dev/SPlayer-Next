/**
 * 封装「原生采集」与「渲染进程麦克风」两条路径，
 * 对外暴露统一的响应式阶段 / 音量 / 候选 / 错误状态
 */

import type {
  RecognitionCandidate,
  RecognitionError,
  RecognitionEvent,
  RecognitionErrorCode,
  RecognitionPhase,
  RecognitionSource,
} from "@shared/types/recognition";
import {
  captureMicrophone,
  waitCapture,
  type MicrophoneCaptureHandle,
} from "@/services/recognition/microphoneCapture";
import * as player from "@/core/player";
import { useStatusStore } from "@/stores/status";

/** 默认采集时长 */
const DEFAULT_DURATION_MS = 8000;

/** 将麦克风采集异常映射为识别错误码 */
const mapMicError = (error: unknown): RecognitionErrorCode => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      return "permission-denied";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "no-device";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "capture-failed";
    }
  }
  return "capture-failed";
};

export const useRecognitionSession = () => {
  /** 原生采集能力；null 表示仍在检测 */
  const supported = ref<boolean | null>(null);
  /** 当前识别阶段 */
  const phase = ref<RecognitionPhase>("idle");
  /** capturing 阶段的音量（RMS） */
  const level = ref(0);
  /** done 阶段的候选列表 */
  const candidates = ref<RecognitionCandidate[]>([]);
  /** error 阶段的错误信息 */
  const error = ref<RecognitionError | null>(null);
  /** 本次会话的采集来源 */
  const source = ref<RecognitionSource>("system");

  let unsubscribe: (() => void) | null = null;
  let abort = new AbortController();
  let captureHandle: MicrophoneCaptureHandle | null = null;
  let resetAfterAbort = true;
  /** 渲染进程麦克风会话暂停后是否仍需恢复播放 */
  let shouldResume = false;

  /** 若仍挂着恢复标记则恢复播放并清除 */
  const resumePlayback = (): void => {
    if (shouldResume) {
      shouldResume = false;
      void player.play();
    }
  };

  /** 清空结果状态并回到 idle */
  const reset = (): void => {
    phase.value = "idle";
    level.value = 0;
    candidates.value = [];
    error.value = null;
  };

  /** 处理主进程广播的识别事件 */
  const handleEvent = (event: RecognitionEvent): void => {
    phase.value = event.phase;
    if (event.level !== undefined) level.value = event.level;
    if (event.candidates) candidates.value = event.candidates;
    if (event.error) error.value = event.error;
    if (event.phase !== "capturing") level.value = 0;
    // 识别结束恢复播放
    if (event.phase === "error" || event.phase === "done") {
      resumePlayback();
    }
  };

  /** 渲染进程麦克风路径（macOS/Linux） */
  const captureInRenderer = async (): Promise<void> => {
    abort = new AbortController();
    const signal = abort.signal;
    shouldResume = false;
    if (useStatusStore().isPlaying) {
      void player.pause();
      shouldResume = true;
    }
    try {
      const handle = await captureMicrophone((lvl) => {
        level.value = lvl;
      }, signal);
      captureHandle = handle;
      await waitCapture(DEFAULT_DURATION_MS, signal);
      const pcm = await handle.stop();
      handle.close();
      captureHandle = null;
      if (signal.aborted) {
        resumePlayback();
        return;
      }
      await window.api.recognition.submitPcm(pcm);
    } catch (err) {
      captureHandle = null;
      if (signal.aborted) {
        if (resetAfterAbort) reset();
        resumePlayback();
        return;
      }
      error.value = { code: mapMicError(err), message: String(err) };
      phase.value = "error";
      resumePlayback();
    }
  };

  /**
   * 开始一次识别
   * @param input - 采集来源（原生不可用的平台仅支持 microphone）
   */
  const start = async (input: RecognitionSource): Promise<void> => {
    if (supported.value === null) return;
    reset();
    resetAfterAbort = true;
    source.value = input;
    phase.value = "capturing";
    if (supported.value) {
      await window.api.recognition.start({ source: input, durationMs: DEFAULT_DURATION_MS });
    } else if (input === "microphone") {
      await captureInRenderer();
    } else {
      error.value = { code: "unsupported", message: "当前平台不支持采集系统声音" };
      phase.value = "error";
    }
  };

  /**
   * 取消当前识别
   * @param resetState - 是否同时恢复初始界面
   */
  const stop = (resetState = true): void => {
    resetAfterAbort = resetState;
    void window.api.recognition.cancel();
    abort.abort();
    if (captureHandle) {
      void captureHandle.stop();
      captureHandle.close();
      captureHandle = null;
    }
    resumePlayback();
    if (resetState) reset();
  };

  /** 会话开始时调用 */
  onMounted(() => {
    void window.api.recognition.isSupported().then((value) => {
      supported.value = value;
      if (!value) source.value = "microphone";
    });
    unsubscribe = window.api.recognition.onEvent(handleEvent);
  });

  onBeforeUnmount(() => {
    stop();
    unsubscribe?.();
  });

  return {
    supported,
    phase,
    level,
    candidates,
    error,
    source,
    start,
    stop,
    reset,
  };
};
