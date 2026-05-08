/**
 * 音频加载服务
 *
 * 纯数据获取：通过 IPC 调用 Rust 引擎加载音频，返回从音频流提取的元数据。
 * 调用方持有 Track 身份；本服务仅返回引擎能解析的辅助信息（detail + mediaInfo），
 * 不再合成 Track。
 */

import type { MediaInfo, TrackDetail } from "@shared/types/player";

export interface AudioLoadResult {
  detail: TrackDetail;
  mediaInfo: MediaInfo;
}

/**
 * 加载音频源，返回歌曲详情和引擎提取的元数据
 * @param source - 音频文件路径或网络地址
 * @param autoPlay - 是否自动播放
 * @returns 成功返回 { detail, mediaInfo }，失败返回 null + error
 */
export const loadAudio = async (
  source: string,
  autoPlay = true,
): Promise<{ data: AudioLoadResult | null; error?: string }> => {
  const result = await window.api.player.load(source, autoPlay);
  if (result.success && result.data) {
    return { data: { detail: result.data.detail, mediaInfo: result.data.mediaInfo } };
  }
  return { data: null, error: result.error };
};
