import { net, protocol, session } from "electron";
import { streamingLog } from "@main/utils/logger";
import { MAIN_PARTITION } from "@main/utils/protocol";
import { withStreamingAdapter } from "./connection";

const SCHEME = "streaming-cover";

/**
 * 代理流媒体封面并在主进程附加鉴权
 * @param request - 封面协议请求
 * @returns 封面响应
 */
const handleCover = async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    const serverId = url.searchParams.get("serverId");
    const coverId = url.searchParams.get("coverId");
    const size = Math.min(2000, Math.max(32, Number(url.searchParams.get("size")) || 300));
    if (!serverId || !coverId) return new Response(null, { status: 400 });
    const response = await withStreamingAdapter(serverId, async (config, adapter) => {
      const coverUrl = await adapter.getCoverUrl(config, coverId, size);
      const result = await net.fetch(coverUrl);
      if (result.status === 401 || result.status === 403) {
        throw new Error(`HTTP ${result.status}`);
      }
      return result;
    });
    if (response.status === 404) {
      return new Response(null, { status: 204 });
    }
    if (!response.ok) {
      streamingLog.warn(`流媒体封面请求失败: HTTP ${response.status}`);
      return new Response(null, { status: 502 });
    }
    return response;
  } catch (error) {
    streamingLog.warn("流媒体封面加载失败:", error);
    return new Response(null, { status: 502 });
  }
};

/** 注册流媒体封面协议 */
export const registerStreamingCoverProtocol = (): void => {
  protocol.handle(SCHEME, handleCover);
  session.fromPartition(MAIN_PARTITION).protocol.handle(SCHEME, handleCover);
};
