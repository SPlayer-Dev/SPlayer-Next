/**
 * 歌词加载服务
 *
 * 纯数据获取：根据歌词来源加载歌词内容，返回字符串。
 * 不操作任何 store，不管理状态。
 * 后续可扩展：网络歌词搜索、多源匹配、歌词翻译等。
 */

import type { TrackDetail } from "@shared/types/player";
import type { LyricData } from "@shared/types/lyrics";

/**
 * 加载歌词内容
 * @param detail - 歌曲详情
 * @param source - 歌词数据（来源 + 格式 + 可选平台）
 * @returns 歌词原始内容，失败返回 null
 */
export const loadLyricContent = async (
  detail: TrackDetail,
  source: LyricData,
): Promise<string | null> => {
  if (!source) return null;

  if (source.source === "embedded") {
    return detail.embeddedLyric ?? null;
  }

  // 外置歌词文件
  const lyric = detail.externalLyrics.find((l) => l.format === source.format);
  if (!lyric) return null;

  const result = await window.api.player.readLyricFile(lyric.path);
  return result.success ? (result.data ?? null) : null;
};
