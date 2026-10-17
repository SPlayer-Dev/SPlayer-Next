import type { JsFftData } from "@splayer/audio-engine";

/** 合并本机与远程显示的 FFT 需求，避免任一消费者关闭其他消费者的采样。 */
export class FftSubscriptions {
  private renderer = false;
  private playing = false;
  private applied = false;
  private listeners = new Set<(data: JsFftData) => void>();

  constructor(private readonly apply: (enabled: boolean) => void) {}

  get enabled(): boolean {
    return this.renderer || (this.playing && this.listeners.size > 0);
  }

  setRenderer(enabled: boolean): void {
    this.renderer = enabled;
    this.sync();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.sync();
  }

  subscribe(listener: (data: JsFftData) => void): () => void {
    this.listeners.add(listener);
    this.sync();
    return () => {
      if (this.listeners.delete(listener)) this.sync();
    };
  }

  publish(data: JsFftData): void {
    if (this.playing) for (const listener of this.listeners) listener(data);
  }

  private sync(): void {
    if (this.applied === this.enabled) return;
    this.apply(this.enabled);
    this.applied = this.enabled;
  }
}

/** 每帧 132 字节：SPF1 标识及左右各 64 个量化频段，低频置于中央。 */
export const encodeSpectrum = (data: JsFftData): Uint8Array<ArrayBuffer> => {
  const packet = new Uint8Array(132);
  packet.set([83, 80, 70, 49]);
  for (let c = 0; c < 2; c++) {
    const input = c === 0 ? data.ldata : data.rdata;
    for (let i = 0; i < 64; i++) {
      const start = 8 + Math.floor((i * 120) / 64);
      const end = 8 + Math.floor(((i + 1) * 120) / 64);
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j] ?? 0;
      packet[4 + (c === 0 ? 63 - i : 64 + i)] = Math.round(
        Math.max(0, Math.min(1, sum / (end - start))) * 255,
      );
    }
  }
  return packet;
};
