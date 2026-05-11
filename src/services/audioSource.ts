import type { Track } from "@shared/types/player";
import { useStreamingStore } from "@/stores/streaming";
import { handleError } from "@/utils/errors";

/**
 * 把 Track 解析成可喂给 audio-engine 的 source 字符串
 * - local：track.path
 * - streaming：通过 streaming store 调主进程拼带鉴权的 URL
 * - online：暂未实现，返回 null
 */
export const resolveTrackSource = async (track: Track): Promise<string | null> => {
  if (track.source === "local") return track.path ?? null;
  if (track.source === "streaming") {
    try {
      return await useStreamingStore().getStreamUrl(track);
    } catch (err) {
      handleError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }
  // TODO: online（netease/qqmusic/kugou）
  return null;
};
