import type { StreamingRuntimeConfig, StreamingSyncState } from "@shared/types/streaming";
import { isDbOpen } from "@main/database";
import { streamingLog } from "@main/utils/logger";
import { sendToMain } from "@main/utils/broadcast";
import { withStreamingAdapter } from "./connection";
import { streamPages } from "./pagination";
import {
  clearStreamingStage,
  publishStreamingStage,
  resetStreamingStage,
  stageStreamingPage,
} from "./snapshot";

const running = new Map<
  string,
  { controller: AbortController; pending?: StreamingRuntimeConfig }
>();
const synced = new Set<string>();

/**
 * 推送低频同步任务状态
 * @param state - 任务状态
 */
const notifyState = (state: StreamingSyncState): void => sendToMain("streaming:syncState", state);

/**
 * 启动可取消的完整快照同步；任务状态只保留已配置服务器
 * @param config - 服务器配置
 * @param force - 是否重新获取服务端状态
 * @returns 是否已启动或仍有任务运行
 */
export const queueStreamingSync = (config: StreamingRuntimeConfig, force = false): boolean => {
  const existing = running.get(config.id);
  if (existing) {
    if (existing.controller.signal.aborted || force) existing.pending = config;
    return true;
  }
  if (!force && synced.has(config.id)) return false;
  if (!isDbOpen()) return false;
  const job = {
    controller: new AbortController(),
    pending: undefined as StreamingRuntimeConfig | undefined,
  };
  const signal = job.controller.signal;
  running.set(config.id, job);
  notifyState({ serverId: config.id, state: "running" });
  void (async () => {
    try {
      await withStreamingAdapter(
        config.id,
        async (authenticated, adapter) => {
          // 重登会从头重建暂存，不能把两次会话的分页混在一起
          resetStreamingStage(config.id);
          let songCount = 0;
          const pages =
            adapter.scanSongs?.(authenticated) ??
            streamPages(
              (params) => adapter.listSongs(authenticated, params),
              (track) => track.originalId,
              signal,
            );
          for await (const page of pages) {
            signal.throwIfAborted();
            stageStreamingPage(config.id, "songs", page);
            songCount += page.length;
          }
          for await (const page of streamPages(
            (params) => adapter.listAlbums(authenticated, params),
            (album) => album.id,
            signal,
          ))
            stageStreamingPage(config.id, "albums", page);
          const artists = await adapter.listArtists(authenticated);
          signal.throwIfAborted();
          stageStreamingPage(config.id, "artists", artists);
          const playlists = await adapter.listPlaylists(authenticated);
          signal.throwIfAborted();
          stageStreamingPage(config.id, "playlists", playlists);
          publishStreamingStage(config.id);
          synced.add(config.id);
          sendToMain("streaming:libraryUpdated", config.id);
          streamingLog.info(`${config.type} 媒体库同步完成 [${config.name}]: 歌曲 ${songCount}`);
        },
        signal,
      );
      notifyState({ serverId: config.id, state: "completed" });
    } catch (error) {
      synced.delete(config.id);
      if (signal.aborted) notifyState({ serverId: config.id, state: "cancelled" });
      else {
        const message = error instanceof Error ? error.message : String(error);
        streamingLog.warn(`${config.type} 媒体库同步失败 [${config.name}]: ${message}`);
        notifyState({ serverId: config.id, state: "failed", error: message });
      }
    } finally {
      if (isDbOpen()) clearStreamingStage(config.id);
      running.delete(config.id);
      if (job.pending) queueStreamingSync(job.pending, true);
    }
  })();
  return true;
};

/**
 * 取消网络请求和发布，并释放服务器成功记录
 * @param serverId - 服务器 ID
 */
export const cancelStreamingSync = (serverId: string): void => {
  const job = running.get(serverId);
  if (job) {
    job.pending = undefined;
    job.controller.abort();
  }
  synced.delete(serverId);
};
