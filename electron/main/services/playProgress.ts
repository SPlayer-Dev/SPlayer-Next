/** 默认 scrobble 阈值：时长 ≤30s 不触发，否则 min(时长/2, 240s) */
export const defaultScrobbleThresholdMs = (durationSec: number): number =>
  durationSec <= 30 ? Infinity : Math.min(durationSec / 2, 240) * 1000;

export interface PlayProgressOptions<T> {
  /** 累计播放达阈值时触发一次，playedMs 为达标瞬间的累计时长 */
  onThreshold: (payload: T, playedMs: number) => void;
  /**
   * 轮次结算时触发一次（切歌 / 自然结束 / flush），playedMs 为本轮**最终**累计时长
   *
   * 与 onThreshold 分离，用于「达标即记为听过一次、但时长要按本轮最终值上报」的场景
   * （网易云听歌打卡：上报时机决定计数是否成立，上报时长决定记到的秒数）
   */
  onSettle?: (payload: T, playedMs: number, fired: boolean) => void;
  /** 由时长(秒)算出应累计的毫秒阈值；默认 defaultScrobbleThresholdMs */
  thresholdMs?: (durationSec: number) => number;
  /** 达阈值时的放行判定；返回 false 则不触发也不置已触发标志，下次推进再判（用于"开关关着时不占用本轮"） */
  shouldFire?: () => boolean;
}

export interface PlayProgress<T> {
  /** 加载新曲目（先结算上一首）；payload 为 null 表示当前不可计时 */
  load: (durationSec: number, payload: T | null, playing: boolean) => void;
  /** 播放/暂停状态变化 */
  setPlaying: (playing: boolean) => void;
  /** 进度推进时驱动一次达阈值检查 */
  tick: () => void;
  /** 同曲重复播放 */
  rearm: () => void;
  /** 自然结束：结算并清空 */
  end: () => void;
  /** 结算当前轮次但不清空（同曲重播 / 退出前补发）；每轮只会结算一次 */
  flush: () => void;
  /** 复位（断开 / 关闭总开关） */
  reset: () => void;
  /** 当前累计实际播放毫秒 */
  elapsedMs: () => number;
  /** 当前曲目阈值（ms），无曲目返回 Infinity */
  thresholdMs: () => number;
  /** 本轮是否已触发 */
  hasFired: () => boolean;
}

export const createPlayProgress = <T>(options: PlayProgressOptions<T>): PlayProgress<T> => {
  const computeThreshold = options.thresholdMs ?? defaultScrobbleThresholdMs;
  let payload: T | null = null;
  let durationSec = 0;
  let playedMs = 0;
  let playSince: number | null = null;
  let fired = false;
  /** 本轮是否已完成结算，避免 flush 与 end / load 重复上报 */
  let settled = false;

  const elapsedMs = (): number => playedMs + (playSince != null ? Date.now() - playSince : 0);
  const thresholdMs = (): number => (payload != null ? computeThreshold(durationSec) : Infinity);

  const maybeFire = (): void => {
    if (payload == null || fired) return;
    const played = elapsedMs();
    if (played < thresholdMs()) return;
    if (options.shouldFire && !options.shouldFire()) return;
    fired = true;
    options.onThreshold(payload, played);
  };

  /** 累加当前播放段并结算本轮（每轮只会真正结算一次） */
  const settle = (): void => {
    if (playSince != null) {
      playedMs += Date.now() - playSince;
      playSince = null;
    }
    maybeFire();
    if (payload == null || settled || !options.onSettle) return;
    settled = true;
    options.onSettle(payload, playedMs, fired);
  };

  const clear = (): void => {
    payload = null;
    durationSec = 0;
    playedMs = 0;
    playSince = null;
    fired = false;
    settled = false;
  };

  return {
    load: (nextDurationSec, nextPayload, playing) => {
      settle();
      clear();
      payload = nextPayload;
      durationSec = nextDurationSec;
      playSince = nextPayload != null && playing ? Date.now() : null;
    },
    setPlaying: (playing) => {
      if (payload == null) return;
      if (playing) {
        if (playSince == null) playSince = Date.now();
      } else if (playSince != null) {
        playedMs += Date.now() - playSince;
        playSince = null;
      }
      maybeFire();
    },
    tick: maybeFire,
    rearm: () => {
      if (payload == null) return;
      const wasPlaying = playSince != null;
      playedMs = 0;
      fired = false;
      settled = false;
      playSince = wasPlaying ? Date.now() : null;
    },
    end: () => {
      settle();
      clear();
    },
    flush: () => {
      // 结算不打断计时：仍在播放时接着累计，rearm 后仍能开始新一轮
      const wasPlaying = playSince != null;
      settle();
      if (wasPlaying) playSince = Date.now();
    },
    reset: clear,
    elapsedMs,
    thresholdMs,
    hasFired: () => fired,
  };
};
