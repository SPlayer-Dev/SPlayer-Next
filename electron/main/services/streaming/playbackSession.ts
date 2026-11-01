import type { StreamingPlaybackReport } from "./adapters/types";

interface PlaybackIdentity {
  trackId: string;
  sessionId: string;
  mediaSourceId?: string;
  durationMs: number;
}

/** 单次播放的有界上报状态机，只保留一个在途请求和待发送的最后进度 */
export class StreamingPlaybackSession {
  private started = false;
  private stopped = false;
  private paused = true;
  private positionMs = 0;
  private listenedMs = 0;
  private scrobbled = false;
  private startedAt = 0;
  private lastTick: number;
  private lastProgress: number;
  private queue: StreamingPlaybackReport[] = [];
  private sending?: Promise<void>;

  /**
   * 创建一次播放会话
   * @param identity - 单曲及媒体源标识
   * @param report - 协议上报入口，失败由调用方记录
   * @param now - 单调时钟
   * @param wallClock - 服务端播放时间使用的 Unix 毫秒时钟
   */
  constructor(
    private readonly identity: PlaybackIdentity,
    private readonly report: (report: StreamingPlaybackReport) => Promise<void>,
    private readonly now: () => number = () => performance.now(),
    private readonly wallClock: () => number = () => Date.now(),
  ) {
    this.lastTick = this.lastProgress = now();
  }

  /**
   * 按实际播放状态更新会话，首次播放才发送开始事件
   * @param playing - 原生引擎是否正在播放
   */
  state(playing: boolean): void {
    if (this.stopped) return;
    if (playing === !this.paused && this.started) return;
    this.tick();
    this.paused = !playing;
    if (playing && !this.started) {
      this.started = true;
      this.startedAt = this.wallClock();
      this.enqueue("start");
    } else if (this.started) this.enqueue("progress", playing ? "Unpause" : "Pause");
  }

  /**
   * 记录实际收听时间，跳转不能代替收听
   * @param positionMs - 原生播放进度
   */
  position(positionMs: number): void {
    if (this.stopped) return;
    const advancing = positionMs > this.positionMs;
    this.tick(advancing);
    this.positionMs = positionMs;
    if (!this.started) return;
    if (
      !this.scrobbled &&
      this.identity.durationMs > 0 &&
      this.listenedMs >= Math.min(this.identity.durationMs / 2, 240_000)
    ) {
      this.scrobbled = true;
      this.enqueue("scrobble");
    }
    if (this.now() - this.lastProgress >= 10_000) {
      this.lastProgress = this.now();
      this.enqueue("progress");
    }
  }

  /**
   * 跳转后立即校准服务端进度，保持已收听时间
   * @param positionMs - 跳转后的毫秒位置
   */
  seek(positionMs: number): void {
    if (this.stopped) return;
    this.tick(false);
    this.positionMs = positionMs;
    if (this.started) this.enqueue("progress");
  }

  /**
   * 结束会话，重复停止不会重复上报
   * @returns 所有待发送事件结束
   */
  stop(): Promise<void> {
    if (!this.stopped) {
      this.tick();
      this.stopped = true;
      if (this.started) this.enqueue("stop");
    }
    return this.sending ?? Promise.resolve();
  }

  /**
   * 累计可确认的收听时间，限制阻塞或断流导致的长时间空档
   * @param advancing - 音频进度是否向前推进
   */
  private tick(advancing = true): void {
    const now = this.now();
    if (advancing && this.started && !this.paused)
      this.listenedMs += Math.max(0, Math.min(now - this.lastTick, 1000));
    this.lastTick = now;
  }

  /**
   * 合并排队中的进度，保留开始、打卡和停止的顺序
   * @param event - 上报事件
   * @param reason - 进度变更原因
   */
  private enqueue(
    event: StreamingPlaybackReport["event"],
    reason: StreamingPlaybackReport["reason"] = "TimeUpdate",
  ): void {
    const report: StreamingPlaybackReport = {
      event,
      reason,
      trackId: this.identity.trackId,
      sessionId: this.identity.sessionId,
      mediaSourceId: this.identity.mediaSourceId,
      positionMs: this.positionMs,
      paused: this.paused,
      startedAt: this.startedAt,
    };
    if (event === "progress")
      this.queue = this.queue.filter(
        (item) =>
          item.event !== "progress" ||
          (reason === "TimeUpdate" ? item.reason !== "TimeUpdate" : item.reason === "TimeUpdate"),
      );
    this.queue.push(report);
    if (!this.sending)
      this.sending = this.flush().finally(() => {
        this.sending = undefined;
      });
  }

  /** 按事件顺序发送，单个失败不阻塞停止通知 */
  private async flush(): Promise<void> {
    while (this.queue.length) await this.report(this.queue.shift()!);
  }
}
