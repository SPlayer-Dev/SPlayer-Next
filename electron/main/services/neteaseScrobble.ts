import type { PlaybackContext, Track } from "@shared/types/player";
import type { NeteaseScrobbleMode } from "@shared/types/settings";
import { toNeteaseScrobbleTrack, type NeteaseScrobbleTrack } from "@shared/utils/neteaseScrobble";
import { store } from "@main/store";
import { callNetease, getNeteaseCookies } from "@main/apis/netease";
import { neteaseLog } from "@main/utils/logger";
import { createPlayProgress } from "@main/services/playProgress";

interface PlaybackRound {
  track: NeteaseScrobbleTrack;
  account: string;
  mode: NeteaseScrobbleMode;
  started: boolean;
}

const MAX_PENDING_REPORTS = 16;
let pendingReports = 0;
let current: PlaybackRound | null = null;
let isPlaying = false;

/**
 * 轮次固定使用开始时选择的协议，网页发送两个动作，NCBL 在结算时上传
 * @param round - 本轮轻量曲目信息与所属账号
 * @param action - 本轮开始或结束动作
 * @param playedMs - 结束时累计的实际播放毫秒数
 */
const report = (round: PlaybackRound, action: "startPlay" | "play", playedMs = 0): void => {
  if (round.mode === "ncbl" && action === "startPlay") return;
  if (pendingReports >= MAX_PENDING_REPORTS) {
    neteaseLog.warn("播放日志任务过多，本次上报已跳过");
    return;
  }
  pendingReports++;
  void callNetease(round.mode === "ncbl" ? "scrobble_v1" : "scrobble", {
    id: round.track.id,
    resourceType: round.track.resourceType,
    ...(round.mode === "ncbl"
      ? { ...round.track.ncbl, name: round.track.title, total: round.track.durationSec }
      : { action }),
    cookie: { ...getNeteaseCookies() },
    ...(action === "play" ? { time: Math.round(playedMs / 1000) } : {}),
  })
    .then((response) => {
      if (Number(response.body?.code) !== 200 && response.body?.data !== "success")
        throw new Error(String(response.body?.msg || "播放日志上报失败"));
      neteaseLog.debug(`播放日志(${action}): ${round.track.title}`);
    })
    .catch((error) => neteaseLog.warn(`播放日志上报失败(${action}):`, error))
    .finally(() => {
      pendingReports--;
    });
};

/**
 * 播放日志只属于开始播放时的账号，切换账号后不转移旧轮次
 * @param round - 待上报的播放轮次
 * @returns 当前登录与开关是否允许本轮上报
 */
const canReport = (round: PlaybackRound): boolean =>
  Boolean(
    store.get("system.neteaseScrobbleEnabled") &&
    round.account &&
    round.account === getNeteaseCookies().MUSIC_U,
  );

/** 首次实际播放才发送开始日志，暂停恢复沿用同一轮次 */
const begin = (): void => {
  if (!current || current.started || !canReport(current)) return;
  current.started = true;
  report(current, "startPlay");
};

const progress = createPlayProgress<PlaybackRound>({
  onSettle: (round, playedMs) => {
    if (round.started && canReport(round) && Math.round(playedMs / 1000) > 0)
      report(round, "play", playedMs);
  },
});

/**
 * 切歌时结算旧轮次，只有实际收听时间进入结束日志
 * @param track - 渲染层下发的权威曲目
 * @param context - 本次播放的来源上下文
 * @param durationMs - 引擎确认的时长
 * @param autoPlay - 是否自动播放
 */
export const onTrackLoaded = (
  track: Track | null,
  context: PlaybackContext | undefined,
  durationMs: number,
  autoPlay: boolean,
): void => {
  const mode: NeteaseScrobbleMode =
    store.get("system.neteaseScrobbleMode") === "ncbl" ? "ncbl" : "legacy";
  const meta = toNeteaseScrobbleTrack(track, context, durationMs, mode);
  current = meta
    ? { track: meta, account: getNeteaseCookies().MUSIC_U || "", mode, started: false }
    : null;
  isPlaying = autoPlay;
  progress.load(meta?.durationSec ?? 0, current, autoPlay);
  if (autoPlay) begin();
};

/**
 * 暂停期间不累计时间，也不拆分同一轮播放
 * @param playing - 是否正在播放
 */
export const onState = (playing: boolean): void => {
  isPlaying = playing;
  if (playing) begin();
  progress.setPlaying(playing);
};

/**
 * 进度跳转不增加实际收听时间，计时只跟随播放状态
 * @param _positionMs - 当前源时间位置
 */
export const onPosition = (_positionMs: number): void => {
  if (isPlaying) begin();
};

/** 自然结束先结算，保留一份轻量元数据供明确的单曲重播通知使用 */
export const onEnded = (): void => {
  isPlaying = false;
  progress.end();
};

/** 单曲循环不重新解码，重播通知为当前曲目开启新的计时轮次 */
export const onRepeatOneRestart = (): void => {
  isPlaying = false;
  if (!current) return;
  current = { ...current, started: false };
  progress.load(current.track.durationSec, current, false);
};

/** 主动停止结算后释放曲目信息，后续状态通知不能恢复旧轮次 */
export const onStopped = (): void => {
  isPlaying = false;
  progress.end();
  current = null;
};
