import type { Track } from "@shared/types/player";
import type { QualityLevel } from "@/utils/quality";
import { isPlatform } from "@shared/types/platform";
import { useStreamingStore } from "@/stores/streaming";
import { useSettingsStore } from "@/stores/settings";
import { resolveByPlugin } from "@/services/audioSource";
import { resolveNeteaseDownloadUrl } from "@/apis/song/netease";

/** 下载源解析结果 */
export interface DownloadSource {
  url: string;
  /** 已知格式（flac/mp3 等），用于扩展名 */
  format?: string;
  /** 已知体积（字节） */
  size?: number;
}

/**
 * 按下载音质解析歌曲下载地址
 * @param track - 要下载的歌曲
 * @param level - 下载音质档位
 * @returns 下载源；无法下载（VIP/试听/无插件/流媒体失败）返回 null
 */
export const resolveDownloadSource = async (
  track: Track,
  level: QualityLevel,
): Promise<DownloadSource | null> => {
  // 流媒体
  if (track.source === "streaming") {
    try {
      const url = await useStreamingStore().getStreamUrl(track, {
        playSessionId: crypto.randomUUID(),
      });
      return { url };
    } catch {
      return null;
    }
  }
  // 网易云官方接口
  if (track.source === "netease") {
    try {
      const usePlayback = useSettingsStore().system.download.usePlaybackForDownload;
      const resolved = await resolveNeteaseDownloadUrl(track, level, usePlayback);
      if (resolved) return resolved;
    } catch {
      // 官方失败回落插件
    }
  }
  // 其他播放源走插件
  if (isPlatform(track.source)) {
    const res = await resolveByPlugin(track, level);
    if (res.ok && !res.isTrial) return { url: res.url };
  }
  return null;
};
