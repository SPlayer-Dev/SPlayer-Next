/**
 * 下载歌词解析
 *
 * 取歌曲歌词文本（用于内嵌到标签 / 写 .lrc）。来源在渲染层，因此在入队前解析好带给主进程。
 */

import type { Track } from "@shared/types/player";
import type { LyricFormat, LyricInput } from "@shared/types/lyrics";
import { isPlatform } from "@shared/types/platform";
import { buildDownloadLyric } from "@/utils/lyric/serialize";
import {
  resolveLocalRepoLyric,
  resolveOnlineByPreference,
  resolvePluginLyric,
  resolveStreamingByPreference,
  resolveTTMLOverlay,
  type OnlineResult,
  type ResolvedLyric,
} from "@/services/lyric/resolve";

/** 下载用歌词 */
export interface DownloadLyric extends LyricInput {
  format: LyricFormat;
}

/** 转为下载歌词结构 */
const toDownloadLyric = (lyric: ResolvedLyric): DownloadLyric => ({
  format: lyric.source.format,
  ...lyric.input,
});

/** 判断候选歌词是否能被下载序列化使用 */
const toUsableDownloadLyric = (lyric: ResolvedLyric | null): DownloadLyric | null => {
  if (!lyric) return null;
  const downloadLyric = toDownloadLyric(lyric);
  const hasContent =
    buildDownloadLyric(downloadLyric, downloadLyric.format, "lrc") ||
    buildDownloadLyric(downloadLyric, downloadLyric.format, "ttml");
  return hasContent ? downloadLyric : null;
};

/** 在线歌词优先尝试 TTML，失败再回落原结果 */
const resolveOnlineDownloadLyric = async (
  track: Track,
  online: OnlineResult | null,
): Promise<DownloadLyric | null> => {
  if (!online) return null;
  const ttml = await resolveTTMLOverlay(track, online);
  return (
    toUsableDownloadLyric(ttml) ??
    toUsableDownloadLyric({ source: online.source, input: online.input })
  );
};

/**
 * 取歌曲歌词文本
 * @param track - 歌曲
 * @returns 歌词文本与格式；无歌词返回 null
 */
export const resolveDownloadLyric = async (track: Track): Promise<DownloadLyric | null> => {
  const local = toUsableDownloadLyric(await resolveLocalRepoLyric(track));
  if (local) return local;
  // 流媒体
  if (track.source === "streaming") {
    return (
      toUsableDownloadLyric(await resolveStreamingByPreference(track)) ??
      toUsableDownloadLyric(await resolvePluginLyric(track))
    );
  }
  // 在线平台
  if (isPlatform(track.source)) {
    const online = await resolveOnlineByPreference(track, { hasLocal: false, localFormat: null });
    return (
      (await resolveOnlineDownloadLyric(track, online)) ??
      toUsableDownloadLyric(await resolvePluginLyric(track))
    );
  }
  return null;
};
