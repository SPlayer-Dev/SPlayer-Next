/**
 * 渲染进程麦克风采集：getUserMedia + AudioWorklet，抽稀到 8 kHz 单声道后累计
 * 仅在原生模块不可用的平台（macOS/Linux）使用
 */

import { MICROPHONE_WORKLET_SOURCE } from "./microphoneCapture.worklet";

/** 目标采样率（与指纹库一致） */
const TARGET_RATE = 8000;
/** 音量回调约每 100 ms 更新一次 */
const LEVEL_BLOCK = TARGET_RATE / 10;

export interface MicrophoneCaptureHandle {
  /** 停止采集并返回累计的 8 kHz 单声道 PCM（取消时返回空数组） */
  stop: () => Promise<Float32Array>;
  /** 释放媒体流与音频上下文，应始终在 stop 后调用 */
  close: () => void;
}

/** 等待可取消的定时器 */
const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * 开始麦克风采集
 * @param onLevel - 音量回调（RMS，约 1 Hz）
 * @param signal - 取消信号
 */
export const captureMicrophone = async (
  onLevel?: (level: number) => void,
  signal?: AbortSignal,
): Promise<MicrophoneCaptureHandle> => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext();
  const blob = new Blob([MICROPHONE_WORKLET_SOURCE], { type: "application/javascript" });
  const workletUrl = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(workletUrl);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }
  const node = new AudioWorkletNode(ctx, "microphone-capture");
  const source = ctx.createMediaStreamSource(stream);
  const output = ctx.createGain();
  output.gain.value = 0;
  source.connect(node);
  node.connect(output);
  output.connect(ctx.destination);

  const chunks: Float32Array[] = [];
  let total = 0;
  let blockEnergy = 0;
  let blockCount = 0;
  /** 等待 flush 回传最后一个块（stop 需等它计入总长度） */
  const flushWaiters: Array<() => void> = [];

  node.port.onmessage = (event: MessageEvent<{ type: string; pcm?: Float32Array }>) => {
    const pcm = event.data?.pcm;
    if (pcm) {
      chunks.push(pcm);
      total += pcm.length;
      for (let i = 0; i < pcm.length; i++) {
        blockEnergy += pcm[i] * pcm[i];
        blockCount++;
      }
      if (blockCount >= LEVEL_BLOCK) {
        onLevel?.(Math.sqrt(blockEnergy / blockCount));
        blockEnergy = 0;
        blockCount = 0;
      }
    }
    const resolve = flushWaiters.shift();
    if (resolve) resolve();
  };

  let closed = false;
  const release = (): void => {
    if (closed) return;
    closed = true;
    source.disconnect();
    node.disconnect();
    output.disconnect();
    void ctx.close();
    for (const track of stream.getTracks()) {
      track.stop();
    }
  };

  return {
    stop: async () => {
      if (signal?.aborted || closed) return new Float32Array(0);
      node.port.postMessage({ type: "flush" });
      await new Promise<void>((resolve) => flushWaiters.push(resolve));
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      chunks.length = 0;
      return merged;
    },
    close: release,
  };
};

/** 等待采集结束（可被取消信号提前唤醒） */
export const waitCapture = (durationMs: number, signal: AbortSignal): Promise<void> =>
  wait(durationMs, signal);
