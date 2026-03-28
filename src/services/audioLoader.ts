/**
 * 音频加载服务
 *
 * 纯数据获取：通过 IPC 调用 Rust 引擎加载音频，返回歌曲信息。
 * 不操作任何 store，不管理状态。
 * 后续可扩展：网络音源解析、音质选择、缓存管理等。
 */

import type { Track, TrackDetail } from "@shared/types/player";

export interface AudioLoadResult {
  track: Track;
  detail: TrackDetail;
}

/**
 * 加载音频源，返回歌曲信息和详情
 * @param source - 音频文件路径或网络地址
 * @param autoPlay - 是否自动播放
 * @returns 成功返回 { track, detail }，失败返回 null
 */
export const loadAudio = async (
  source: string,
  autoPlay = true,
): Promise<AudioLoadResult | null> => {
  const result = await window.api.player.load(source, autoPlay);
  if (result.success && result.data) {
    return { track: result.data.track, detail: result.data.detail };
  }
  return null;
};
