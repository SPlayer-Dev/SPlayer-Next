/**
 * Jellyfin / Emby PlaySession 进度心跳
 *
 * Jellyfin 协议要求客户端在播放期间定期上报：
 * - POST /Sessions/Playing：开播
 * - POST /Sessions/Playing/Progress：每 ~10s 心跳（带 PositionTicks）
 * - POST /Sessions/Playing/Stopped：停止/切歌
 *
 * 不上报的后果：
 * - Jellyfin Web "Now Playing" 不显示
 * - Played 计数 / 最近播放历史不更新
 * - 多端 SyncPlay 不工作
 * - 部分 Jellyfin 版本会主动断流当客户端死亡
 *
 * Subsonic 协议无此机制，按 type 提前过滤
 */
import type { Track } from "@shared/types/player";
import type { StreamingServerConfig } from "@shared/types/streaming";
import { useStreamingStore } from "@/stores/streaming";
import { fetchWithTimeout, normalizeBase } from "./http";

const CLIENT_NAME = "SPlayer-Next";
const CLIENT_VERSION = "1.0.0";
const DEVICE_NAME = "SPlayer Desktop";

const deviceId = (cfg: StreamingServerConfig): string => `splayer-next-${cfg.id}`;

/** 1ms = 10000 个 100ns ticks */
const msToTicks = (ms: number): number => Math.max(0, Math.floor(ms)) * 10_000;

const isJellyLike = (cfg: StreamingServerConfig): boolean =>
  cfg.type === "jellyfin" || cfg.type === "emby";

/** 拼 MediaBrowser 鉴权 header */
const authHeader = (cfg: StreamingServerConfig): string => {
  const parts = [
    `Client="${CLIENT_NAME}"`,
    `Device="${DEVICE_NAME}"`,
    `DeviceId="${deviceId(cfg)}"`,
    `Version="${CLIENT_VERSION}"`,
  ];
  if (cfg.accessToken) parts.push(`Token="${cfg.accessToken}"`);
  return `MediaBrowser ${parts.join(", ")}`;
};

const headers = (cfg: StreamingServerConfig): Record<string, string> => {
  const name = cfg.type === "emby" ? "X-Emby-Authorization" : "Authorization";
  return { "Content-Type": "application/json", [name]: authHeader(cfg) };
};

/** 静默 POST：失败不影响播放 */
const postSilent = async (
  cfg: StreamingServerConfig,
  path: string,
  body: unknown,
): Promise<void> => {
  try {
    await fetchWithTimeout(`${normalizeBase(cfg.url)}/${path}`, {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify(body),
    });
  } catch {
    // 心跳失败不应中断播放
  }
};

/**
 * 通知服务器开播
 * @param cfg 服务器配置
 * @param itemId 歌曲 itemId
 * @param sessionId PlaySessionId（与 stream URL 同源）
 */
export const reportPlaying = async (
  cfg: StreamingServerConfig,
  itemId: string,
  sessionId: string,
): Promise<void> => {
  if (!isJellyLike(cfg) || !cfg.accessToken) return;
  await postSilent(cfg, "Sessions/Playing", {
    ItemId: itemId,
    PlaySessionId: sessionId,
    CanSeek: true,
    PlayMethod: "DirectStream",
  });
};

/**
 * 进度心跳
 * @param cfg 服务器配置
 * @param itemId 歌曲 itemId
 * @param sessionId PlaySessionId
 * @param positionMs 当前位置（毫秒）
 * @param isPaused 是否暂停
 */
export const reportProgress = async (
  cfg: StreamingServerConfig,
  itemId: string,
  sessionId: string,
  positionMs: number,
  isPaused: boolean,
): Promise<void> => {
  if (!isJellyLike(cfg) || !cfg.accessToken) return;
  await postSilent(cfg, "Sessions/Playing/Progress", {
    ItemId: itemId,
    PlaySessionId: sessionId,
    PositionTicks: msToTicks(positionMs),
    IsPaused: isPaused,
    CanSeek: true,
    PlayMethod: "DirectStream",
    EventName: isPaused ? "pause" : "timeupdate",
  });
};

/**
 * 通知服务器停止
 * @param cfg 服务器配置
 * @param itemId 歌曲 itemId
 * @param sessionId PlaySessionId
 * @param positionMs 停止时位置（毫秒）
 */
export const reportStopped = async (
  cfg: StreamingServerConfig,
  itemId: string,
  sessionId: string,
  positionMs: number,
): Promise<void> => {
  if (!isJellyLike(cfg) || !cfg.accessToken) return;
  await postSilent(cfg, "Sessions/Playing/Stopped", {
    ItemId: itemId,
    PlaySessionId: sessionId,
    PositionTicks: msToTicks(positionMs),
  });
};

/**
 * 主动登出，释放 server 端 session
 * @param cfg - 服务器配置
 */
export const logout = async (cfg: StreamingServerConfig): Promise<void> => {
  if (!isJellyLike(cfg) || !cfg.accessToken) return;
  await postSilent(cfg, "Sessions/Logout", {});
};

let lastPlaySession: { trackId: string; sessionId: string } | null = null;

/**
 * 取或生成 PlaySessionId，trackId 不变则复用
 * @param trackId - Track 全局 id
 * @returns PlaySessionId（UUID）
 */
export const sessionIdForTrack = (trackId: string): string => {
  if (lastPlaySession?.trackId === trackId) return lastPlaySession.sessionId;
  const sessionId = crypto.randomUUID();
  lastPlaySession = { trackId, sessionId };
  return sessionId;
};

let activeSession: {
  cfg: StreamingServerConfig;
  trackId: string;
  originalId: string;
  sessionId: string;
} | null = null;
let lastProgressAt = 0;
const PROGRESS_INTERVAL_MS = 10_000;

const findCfgForTrack = (track: Track): StreamingServerConfig | null => {
  if (track.source !== "streaming" || !track.serverId) return null;
  return useStreamingStore().servers.find((s) => s.id === track.serverId) ?? null;
};

/**
 * 通知当前 Track 切换；切到 null 表示停止。给上一首发 Stopped，给新一首发 Playing
 * @param track - 新的当前 Track，null 表示停止
 * @param positionMs - 旧 Track 停止时的位置（毫秒）
 */
export const notifyTrackChanged = (track: Track | null, positionMs = 0): void => {
  if (activeSession && (!track || activeSession.trackId !== track.id)) {
    const prev = activeSession;
    activeSession = null;
    lastProgressAt = 0;
    void reportStopped(prev.cfg, prev.originalId, prev.sessionId, positionMs);
  }
  if (!track || !track.originalId) return;
  if (activeSession?.trackId === track.id) return;
  const cfg = findCfgForTrack(track);
  if (!cfg) return;
  const sessionId = sessionIdForTrack(track.id);
  activeSession = { cfg, trackId: track.id, originalId: track.originalId, sessionId };
  lastProgressAt = Date.now();
  void reportPlaying(cfg, track.originalId, sessionId);
};

/**
 * 进度心跳，节流到 10s 一次
 * @param positionMs - 当前播放位置（毫秒）
 * @param isPaused - 是否暂停
 */
export const notifyProgress = (positionMs: number, isPaused: boolean): void => {
  if (!activeSession) return;
  const now = Date.now();
  if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
  lastProgressAt = now;
  void reportProgress(
    activeSession.cfg,
    activeSession.originalId,
    activeSession.sessionId,
    positionMs,
    isPaused,
  );
};

/**
 * 暂停/恢复时立即上报一次，不受节流限制
 * @param positionMs - 当前播放位置（毫秒）
 * @param isPaused - 是否暂停
 */
export const notifyStateChanged = (positionMs: number, isPaused: boolean): void => {
  if (!activeSession) return;
  lastProgressAt = Date.now();
  void reportProgress(
    activeSession.cfg,
    activeSession.originalId,
    activeSession.sessionId,
    positionMs,
    isPaused,
  );
};
