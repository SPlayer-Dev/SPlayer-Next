import { isDbOpen } from "@main/database";
import { updateStreamingFavorite } from "@main/database/streaming/tracks";
import { sendToMain } from "@main/utils/broadcast";
import { getStreamingServerRevision } from "./config";
import { withStreamingAdapter } from "./connection";
import { recordStreamingStageFavorite } from "./snapshot";

/** 仅保留在途读写，同曲请求按顺序执行并在最后一个请求结束时释放 */
const requests = new Map<string, Promise<boolean>>();

/**
 * 串行读取或写入单曲收藏，统一发布服务端确认的结果
 * @param serverId - 服务器 ID
 * @param trackId - 服务端歌曲 ID
 * @param value - 目标收藏状态，省略时只读取
 * @returns 服务端确认的收藏状态
 */
export const requestStreamingFavorite = (
  serverId: string,
  trackId: string,
  value?: boolean,
): Promise<boolean> => {
  const id = `${serverId}:${trackId}`;
  const revision = getStreamingServerRevision(serverId);
  const previous = requests.get(id) ?? Promise.resolve();
  const request = previous
    .catch(() => {})
    .then(async () => {
      if (getStreamingServerRevision(serverId) !== revision)
        throw new Error("流媒体配置已更新，本次请求已作废");
      const favorite = await withStreamingAdapter(serverId, (config, adapter) =>
        value === undefined
          ? adapter.getFavorite(config, trackId)
          : adapter.setFavorite(config, trackId, value),
      );
      if (isDbOpen()) {
        updateStreamingFavorite(serverId, trackId, favorite);
        recordStreamingStageFavorite(serverId, trackId, favorite);
      }
      sendToMain("streaming:favoriteChanged", { serverId, trackId, favorite });
      return favorite;
    });
  const result = request.finally(() => {
    if (requests.get(id) === result) requests.delete(id);
  });
  requests.set(id, result);
  return result;
};
