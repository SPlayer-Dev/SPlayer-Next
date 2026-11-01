import type { Track, PlayerState } from "@shared/types/player";
import { streamingLog } from "@main/utils/logger";
import { withStreamingAdapter } from "./connection";
import { StreamingPlaybackSession } from "./playbackSession";
import type { StreamingPlaybackSource } from "./adapters/types";
import { streamingSourceForTrack } from "@shared/utils/streamingSource";
import { resolveStreamingMediaSource } from "./mediaSource";
import { getStreamingConfig } from "./config";

let active: { serverId: string; session: StreamingPlaybackSession } | undefined;
let pendingStop: Promise<void> = Promise.resolve();

/**
 * 获取本次播放的媒体源；缓存文件仍保留原服务器身份
 * @param track - 权威单曲元数据
 * @param source - renderer 解析的文件路径或流媒体占位符
 * @returns 媒体源与独立会话 ID
 */
export const prepareStreamingPlayback = async (
  track: Track | undefined,
  source: string,
): Promise<(StreamingPlaybackSource & { sessionId: string }) | undefined> => {
  if (track?.source !== "streaming" || !track.serverId || !track.originalId) return undefined;
  const server = getStreamingConfig().servers.find((item) => item.id === track.serverId);
  if (!server || (server.mediaRevision ?? 0) !== (track.serverRevision ?? 0))
    throw new Error("流媒体账号或地址已更新，请重新选择歌曲");
  const sessionId = crypto.randomUUID();
  const remote = /^https?:\/\/|^streaming:/i.test(source);
  if (!remote) return { url: source, sessionId };
  if (source.startsWith("streaming:") && source !== streamingSourceForTrack(track))
    throw new Error("流媒体音源与歌曲身份不一致");
  const playback = await resolveStreamingMediaSource(
    track.serverId,
    track.originalId,
    sessionId,
    undefined,
    track.serverRevision,
  );
  return { ...playback, sessionId };
};

/**
 * 加载成功后绑定会话，预加载和失败的加载不产生播放记录
 * @param track - 权威单曲元数据
 * @param prepared - 本次播放媒体源
 * @param durationMs - 解码器确认的时长
 * @param playing - 当前引擎状态
 */
export const startStreamingPlayback = (
  track: Track | undefined,
  prepared: (StreamingPlaybackSource & { sessionId: string }) | undefined,
  durationMs: number,
  playing: boolean,
): void => {
  if (!track?.serverId || !track.originalId || !prepared) return;
  const serverId = track.serverId;
  const previousStop = pendingStop;
  let mediaSourceId = prepared.mediaSourceId;
  let serverStarted = false;
  const session = new StreamingPlaybackSession(
    {
      trackId: track.originalId,
      sessionId: prepared.sessionId,
      mediaSourceId: prepared.mediaSourceId,
      durationMs,
    },
    async (report) => {
      await previousStop;
      if (report.event === "start" && active?.session !== session) return;
      if ((report.event === "progress" || report.event === "stop") && !serverStarted) return;
      try {
        await withStreamingAdapter(serverId, async (config, adapter) => {
          if (
            report.event === "start" &&
            !mediaSourceId &&
            (config.type === "jellyfin" || config.type === "emby")
          )
            mediaSourceId = (
              await adapter.preparePlayback(config, report.trackId, report.sessionId)
            ).mediaSourceId;
          await adapter.reportPlayback(config, { ...report, mediaSourceId });
          if (report.event === "start") serverStarted = true;
        });
      } catch (error) {
        streamingLog.warn(`流媒体播放上报失败 [${serverId}]:`, error);
      }
    },
  );
  active = { serverId, session };
  session.state(playing);
};

/**
 * 同步原生播放状态
 * @param state - 引擎状态
 */
export const onStreamingState = (state: PlayerState): void => {
  if (state === "stopped" || state === "idle") {
    void stopStreamingPlayback();
    return;
  }
  active?.session.state(state === "playing");
};

/**
 * 同步播放进度
 * @param positionMs - 毫秒位置
 */
export const onStreamingPosition = (positionMs: number): void =>
  active?.session.position(positionMs);

/**
 * 同步跳转后的进度
 * @param positionMs - 毫秒位置
 */
export const onStreamingSeek = (positionMs: number): void => active?.session.seek(positionMs);

/**
 * 收尾当前服务器会话，新会话会等待旧停止事件发送
 * @param serverId - 只收尾指定服务器，省略则收尾当前会话
 * @returns 收尾完成
 */
export const stopStreamingPlayback = (serverId?: string): Promise<void> => {
  if (!active || (serverId && active.serverId !== serverId)) return pendingStop;
  const previous = active;
  active = undefined;
  pendingStop = previous.session.stop();
  return pendingStop;
};
