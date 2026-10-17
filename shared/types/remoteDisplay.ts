import type { NowPlayingSnapshot, NowPlayingPositionSync } from "./nowPlaying";

/** 局域网显示端的实时播放锚点，所有时间字段使用毫秒。 */
export interface RemoteDisplayPosition extends NowPlayingPositionSync {
  trackId: string | null;
  duration: number;
  volume: number;
}

export type RemoteDisplaySnapshot = NowPlayingSnapshot & RemoteDisplayPosition;
