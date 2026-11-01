import { createPlayProgress } from "@main/services/playProgress";

/** scrobbler 对外通知的曲目数据 */
export interface ScrobbleTrack {
  /** 歌曲名 */
  title: string;
  /** 主艺人名 */
  artist: string;
  /** 专辑名（可能为空） */
  album: string;
  /** 时长（秒） */
  durationSec: number;
  /** 开始播放的 Unix 时间戳（秒），scrobble 用 */
  timestamp: number;
}

/** index.ts 注入的回调：内部做配置/会话判定 */
export interface ScrobblerHandlers {
  /** 应上报「正在播放」时调用 */
  onNowPlaying: (track: ScrobbleTrack) => void;
  /** 达到 scrobble 阈值时调用 */
  onScrobble: (track: ScrobbleTrack) => void;
}

let handlers: ScrobblerHandlers | null = null;
let current: ScrobbleTrack | null = null;
/** 当前曲目是否已发过 now playing */
let nowPlayingSent = false;

const progress = createPlayProgress<ScrobbleTrack>({
  onThreshold: (track) => handlers?.onScrobble(track),
});

/** 注入回调 */
export const setHandlers = (next: ScrobblerHandlers): void => {
  handlers = next;
};

/** 首次实际播放时上报 now playing */
const sendNowPlaying = (): void => {
  if (!current || nowPlayingSent) return;
  nowPlayingSent = true;
  handlers?.onNowPlaying(current);
};

/**
 * 新曲目加载
 * @param meta - 曲目元数据 + 是否自动播放
 */
export const onTrackLoaded = (meta: {
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  autoPlay: boolean;
}): void => {
  current =
    meta.durationMs <= 0 || !meta.title
      ? null
      : {
          title: meta.title,
          artist: meta.artist,
          album: meta.album,
          durationSec: Math.round(meta.durationMs / 1000),
          timestamp: Math.floor(Date.now() / 1000),
        };
  nowPlayingSent = false;
  progress.load(current?.durationSec ?? 0, current, meta.autoPlay);
  if (current && meta.autoPlay) sendNowPlaying();
};

/**
 * 播放/暂停状态变化
 * @param playing - 是否正在播放
 */
export const onState = (playing: boolean): void => {
  if (playing) sendNowPlaying();
  progress.setPlaying(playing);
};

/** 播放进度推进（驱动阈值检查） */
export const onPosition = (): void => {
  progress.tick();
};

/** 自然播放结束 */
export const onEnded = (): void => {
  progress.end();
  nowPlayingSent = false;
};

/** 单曲重播重新生成开始时间，下一次实际播放再发送正在播放通知 */
export const onRepeatOneRestart = (): void => {
  if (!current) return;
  current = { ...current, timestamp: Math.floor(Date.now() / 1000) };
  nowPlayingSent = false;
  progress.load(current.durationSec, current, false);
};

/** 主动停止结算后释放元数据，不保留可重新开始的轮次 */
export const onStopped = (): void => {
  progress.end();
  current = null;
  nowPlayingSent = false;
};

/** 复位（断开连接 / 关闭总开关时） */
export const reset = (): void => {
  progress.reset();
  current = null;
  nowPlayingSent = false;
};
