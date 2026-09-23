/**
 * 麦克风采集 AudioWorklet 处理器源码
 * Vite 无法直接打包 AudioWorklet 模块，故以字符串形式内联，由 microphoneCapture.ts 通过 Blob URL 加载
 * 处理器把任意采样率输入线性插值抽稀到 8 kHz 单声道，按 1 秒块回传
 */
export const MICROPHONE_WORKLET_SOURCE = `
class MicrophoneCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 8000;
    this.queue = [];
    this.nextInput = 0;
    this.out = [];
    this.outCount = 0;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'flush') {
        this.emitChunk();
      }
    };
  }
  process(inputs) {
    const input = inputs[0] ? inputs[0][0] : null;
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.queue.push(input[i]);
    }
    while (this.nextInput + this.ratio <= this.queue.length) {
      const start = Math.floor(this.nextInput);
      const end = Math.min(Math.ceil(this.nextInput + this.ratio), this.queue.length);
      let sum = 0;
      for (let i = start; i < end; i++) sum += this.queue[i];
      this.out.push(sum / (end - start));
      this.outCount++;
      this.nextInput += this.ratio;
      const consumed = Math.floor(this.nextInput);
      if (consumed >= 1024) {
        this.queue.splice(0, consumed);
        this.nextInput -= consumed;
      }
    }
    if (this.outCount >= 8000) this.emitChunk();
    return true;
  }
  emitChunk() {
    const buf = new Float32Array(this.outCount);
    buf.set(this.out);
    this.port.postMessage({ type: 'chunk', pcm: buf }, [buf.buffer]);
    this.out = [];
    this.outCount = 0;
  }
}
registerProcessor('microphone-capture', MicrophoneCaptureProcessor);
`;
