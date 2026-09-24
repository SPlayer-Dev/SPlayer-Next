/** 默认 scrobble 阈值：时长 ≤30s 不触发，否则 min(时长/2, 240s) */
export const defaultScrobbleThresholdMs = (durationSec: number): number =>
  durationSec <= 30 ? Infinity : Math.min(durationSec / 2, 240) * 1000;

export interface PlayProgressOptions<T> {
  /** 本轮结算（切歌 / 结束）时触发一次，playedMs 为本轮最终累计播放时长 */
  onThreshold: (payload: T, playedMs: number) => void;
  /** 由时长(秒)算出应累计的毫秒阈值；默认 defaultScrobbleThresholdMs */
  thresholdMs?: (durationSec: number) => number;
  /** 结算时的放行判定；返回 false 则不触发也不置已达标标志，下次结算再判（用于"开关关着时不占用本轮"） */
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
  /** 复位（断开 / 关闭总开关） */
  reset: () => void;
  /** 当前累计实际播放毫秒 */
  elapsedMs: () => number;
  /** 当前曲目阈值（ms），无曲目返回 Infinity */
  thresholdMs: () => number;
  /** 本轮是否已达标；结算前为待结算状态 */
  hasFired: () => boolean;
}

export const createPlayProgress = <T>(options: PlayProgressOptions<T>): PlayProgress<T> => {
  const computeThreshold = options.thresholdMs ?? defaultScrobbleThresholdMs;
  let payload: T | null = null;
  let durationSec = 0;
  let playedMs = 0;
  let playSince: number | null = null;
  let fired = false;
  /** 已达标但尚未结算，等本轮结束时一并按最终时长触发 */
  let pending = false;

  const elapsedMs = (): number => playedMs + (playSince != null ? Date.now() - playSince : 0);
  const thresholdMs = (): number => (payload != null ? computeThreshold(durationSec) : Infinity);

  const fire = (target: T): void => {
    fired = true;
    pending = false;
    options.onThreshold(target, elapsedMs());
  };

  const maybeFire = (): void => {
    if (payload == null || fired || pending) return;
    if (elapsedMs() < thresholdMs()) return;
    // 达标不立即上报：本轮时长仍在增长，结算时才能拿到最终结果
    pending = true;
  };

  const settle = (): void => {
    if (playSince != null) {
      playedMs += Date.now() - playSince;
      playSince = null;
    }
    maybeFire();
    // 结算点按本轮最终累计时长触发；开关关着时保持达标状态，下次结算再判
    if (pending && payload != null) {
      if (options.shouldFire && !options.shouldFire()) return;
      fire(payload);
    }
  };

  const clear = (): void => {
    payload = null;
    durationSec = 0;
    playedMs = 0;
    playSince = null;
    fired = false;
    pending = false;
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
      pending = false;
      playSince = wasPlaying ? Date.now() : null;
    },
    end: () => {
      settle();
      clear();
    },
    reset: clear,
    elapsedMs,
    thresholdMs,
    hasFired: () => fired || pending,
  };
};
