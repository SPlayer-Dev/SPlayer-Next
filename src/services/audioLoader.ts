/**
 * 音频加载服务
 *
 * 纯数据获取：通过 IPC 调用 Rust 引擎加载音频，返回从音频流提取的元数据。
 * 调用方持有 Track 身份；本服务仅返回引擎能解析的辅助信息（detail + mediaInfo）。
 * options.meta 用于让主进程在 SMTC/托盘上用渲染层的权威元数据，
 * 避免被引擎稀疏 tag 覆盖（streaming/online 必须下发）。
 */

import type { LoadOptions, MediaInfo, TrackDetail } from "@shared/types/player";

export interface AudioLoadResult {
  detail: TrackDetail;
  mediaInfo: MediaInfo;
}

/**
 * 加载音频源
 * @param source - 音频文件路径或网络地址
 * @param options - 加载选项（autoPlay / meta）
 */
export const loadAudio = async (
  source: string,
  options?: LoadOptions,
): Promise<{ data: AudioLoadResult | null; error?: string }> => {
  const result = await window.api.player.load(source, options);
  if (result.success && result.data) {
    return { data: { detail: result.data.detail, mediaInfo: result.data.mediaInfo } };
  }
  return { data: null, error: result.error };
};
