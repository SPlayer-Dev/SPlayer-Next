/** 跨机器播放锚点：使用往返时延估计时钟差，避免依赖两台机器的系统时间一致。 */
export class PlaybackClock {
  private position = 0;
  private at = 0;
  private initialized = false;
  private serverOffset: number | null = null;
  private bestRtt = Infinity;
  playing = false;
  speed = 1;

  calibrate(sent: number, received: number, serverTime: number): void {
    const rtt = received - sent;
    if (rtt < 0 || rtt > this.bestRtt * 1.5) return;
    this.bestRtt = Math.min(rtt, this.bestRtt);
    this.serverOffset = serverTime - (sent + received) / 2;
  }

  sync(
    data: { position: number; playing: boolean; speed: number; sendTimestamp: number },
    now: number,
    force = false,
  ): boolean {
    const age =
      this.serverOffset === null
        ? 0
        : Math.max(0, Math.min(2000, now + this.serverOffset - data.sendTimestamp));
    const candidate = data.position + (data.playing ? age * data.speed : 0);
    const projected = this.current(now);
    const jump = force || !this.initialized || Math.abs(candidate - projected) > 500;
    const changed = this.playing !== data.playing || this.speed !== data.speed;
    if (jump || changed || !data.playing) {
      this.position = candidate;
      this.at = now;
    } else if (Math.abs(candidate - projected) > 50) {
      this.position = projected + (candidate - projected) * 0.15;
      this.at = now;
    }
    this.initialized = true;
    this.playing = data.playing;
    this.speed = data.speed;
    return jump;
  }

  current(now: number): number {
    return Math.max(
      0,
      this.position + (this.playing ? Math.max(0, now - this.at) * this.speed : 0),
    );
  }

  freeze(now: number): void {
    this.position = this.current(now);
    this.at = now;
    this.playing = false;
  }

  resetNetwork(): void {
    this.serverOffset = null;
    this.bestRtt = Infinity;
  }
}
