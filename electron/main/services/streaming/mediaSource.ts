import { withStreamingAdapter } from "./connection";
import type { StreamingPlaybackSource } from "./adapters/types";
import { StreamingRequestError } from "./errors";

/**
 * 获取原文件下载响应，过期鉴权只恢复一次，不触发播放上报
 * @param serverId - 服务器 ID
 * @param trackId - 服务端歌曲 ID
 * @param signal - 下载任务取消信号
 * @param serverRevision - 歌曲所属媒体身份代次
 * @returns 保留文件名与格式信息的下载响应
 */
export const fetchStreamingDownload = (
  serverId: string,
  trackId: string,
  signal: AbortSignal,
  serverRevision = 0,
): Promise<Response> =>
  withStreamingAdapter(
    serverId,
    async (config, adapter) => {
      if ((config.mediaRevision ?? 0) !== serverRevision)
        throw new Error("流媒体账号或地址已更新，请重新选择歌曲");
      const url = await adapter.getDownloadUrl(config, trackId);
      const response = await fetch(url, { signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new StreamingRequestError(`流媒体下载失败: HTTP ${response.status}`, response.status);
      }
      if (response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        // Subsonic 可能以 HTTP 200 返回协议错误，只读取有界错误体
        const reader = response.body?.getReader();
        if (!reader) throw new Error("服务器未返回可下载的音频文件");
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (length <= 8192) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > 8192) throw new Error("服务器未返回可下载的音频文件");
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          "subsonic-response"?: { error?: { code?: number; message?: string } };
        };
        const error = body["subsonic-response"]?.error;
        throw new StreamingRequestError(
          error?.message ?? "服务器未返回可下载的音频文件",
          undefined,
          error?.code,
        );
      }
      return response;
    },
    signal,
  );

/**
 * 在主进程解析音频源，单纯解析不产生播放上报
 * @param serverId - 服务器 ID
 * @param trackId - 服务端歌曲 ID
 * @param sessionId - 播放或下载上下文 ID
 * @param signal - 取消信号
 * @param serverRevision - 歌曲所属媒体身份代次
 * @returns 已鉴权音频源
 */
export const resolveStreamingMediaSource = (
  serverId: string,
  trackId: string,
  sessionId: string,
  signal?: AbortSignal,
  serverRevision = 0,
): Promise<StreamingPlaybackSource> =>
  withStreamingAdapter(
    serverId,
    (config, adapter) => {
      if ((config.mediaRevision ?? 0) !== serverRevision)
        throw new Error("流媒体账号或地址已更新，请重新选择歌曲");
      return adapter.preparePlayback(config, trackId, sessionId);
    },
    signal,
  );
