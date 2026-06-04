import { shell } from "electron";
import { store } from "@main/store";
import { lastfmLog } from "@main/utils/logger";
import * as client from "./client";
import * as credentials from "./credentials";
import * as scrobbler from "./scrobbler";
import type { LastfmStatus, LastfmConnectResult } from "@shared/types/lastfm";

/** 当前会话（内存态） */
let session: credentials.LastfmCredentials | null = null;
/** 是否有授权轮询在进行 */
let connecting = false;
/** 取消授权标志 */
let cancelFlag = false;

/** 读取实时配置 */
const cfg = () => store.get("lastfm");

/** 延时 */
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 启动初始化：载入本地凭证并接线 scrobbler 回调 */
export const init = (): void => {
  session = credentials.load();
  if (session) lastfmLog.info(`已载入 Last.fm 凭证: ${session.username}`);
  scrobbler.setHandlers({
    onNowPlaying: (track) => {
      const config = cfg();
      if (!config.enabled || !config.nowPlaying || !session) return;
      client
        .updateNowPlaying(
          session.sessionKey,
          track.title,
          track.artist,
          track.album || undefined,
          track.durationSec || undefined,
        )
        .catch((err) => lastfmLog.warn("updateNowPlaying 失败:", err));
    },
    onScrobble: (track) => {
      const config = cfg();
      if (!config.enabled || !config.scrobble || !session) return;
      client
        .scrobble(
          session.sessionKey,
          track.title,
          track.artist,
          track.timestamp,
          track.album || undefined,
          track.durationSec || undefined,
        )
        .then(() => lastfmLog.debug(`scrobble: ${track.artist} - ${track.title}`))
        .catch((err) => lastfmLog.warn("scrobble 失败:", err));
    },
  });
};

/** 配置变更副作用：关闭总开关时复位状态机 */
export const reloadConfig = (): void => {
  if (!cfg().enabled) scrobbler.reset();
};

/** 新曲目加载（来自 player:load） */
export const onTrackLoaded = (meta: {
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  autoPlay: boolean;
}): void => {
  if (cfg().enabled) scrobbler.onTrackLoaded(meta);
};

/** 播放/暂停变化 */
export const onState = (playing: boolean): void => {
  if (cfg().enabled) scrobbler.onState(playing);
};

/** 进度推进 */
export const onPosition = (): void => {
  if (cfg().enabled) scrobbler.onPosition();
};

/** 播放结束 */
export const onEnded = (): void => {
  if (cfg().enabled) scrobbler.onEnded();
};

/** 查询连接状态 */
export const getStatus = (): LastfmStatus => ({
  connected: Boolean(session),
  username: session?.username ?? "",
});

/** 取消正在进行的授权 */
export const cancelConnect = (): void => {
  cancelFlag = true;
};

/**
 * 发起授权：getToken → 打开浏览器 → 轮询 getSession（上限约 120s）
 * @returns 连接结果
 */
export const connect = async (): Promise<LastfmConnectResult> => {
  if (connecting) return { connected: false, reason: "error" };
  connecting = true;
  cancelFlag = false;
  try {
    const token = await client.getToken();
    await shell.openExternal(client.getAuthUrl(token));
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (cancelFlag) return { connected: false, reason: "canceled" };
      await delay(3000);
      if (cancelFlag) return { connected: false, reason: "canceled" };
      try {
        const result = await client.getSession(token);
        session = { username: result.name, sessionKey: result.key };
        credentials.save(result.name, result.key);
        lastfmLog.info(`已连接 Last.fm: ${result.name}`);
        return { connected: true, username: result.name };
      } catch (err) {
        // error 14 = 用户尚未授权
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("Last.fm 14")) lastfmLog.warn("getSession 轮询出错:", err);
      }
    }
    return { connected: false, reason: "timeout" };
  } catch (err) {
    lastfmLog.error("连接失败:", err);
    return { connected: false, reason: "error" };
  } finally {
    connecting = false;
  }
};

/** 断开并清除凭证 */
export const disconnect = (): void => {
  session = null;
  credentials.clear();
  scrobbler.reset();
  lastfmLog.info("已断开 Last.fm 连接");
};

/**
 * 同步喜欢（来自渲染端 like 切换）；未连接 / 未开启时静默
 * @param artist - 主艺人名
 * @param track - 歌曲名
 * @param loved - true 为 Love，false 为 Unlove
 */
export const love = (artist: string, track: string, loved: boolean): void => {
  const config = cfg();
  if (!config.enabled || !config.loveSync || !session || !artist || !track) return;
  client
    .love(session.sessionKey, track, artist, loved)
    .catch((err) => lastfmLog.warn("love 失败:", err));
};
