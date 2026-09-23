/**
 * 听歌识曲结果适配
 */

import { callNetease } from "@main/apis/netease";
import { recognitionLog } from "@main/utils/logger";

/** 匹配接口返回的原始歌曲信息 */
export interface MatchedSong {
  id: number;
  name: string;
  artists: { name: string }[];
  album?: { name: string; picUrl?: string };
}

interface MatchResponse {
  code?: number;
  data?: {
    result?: { startTime?: number; song?: MatchedSong }[];
  };
}

type MatchResult =
  { ok: true; songs: { song: MatchedSong; startTime?: number }[] } | { ok: false; code: "network" };

/**
 * 将音频指纹交给网易云模块匹配
 * @param fingerprint - AFP 生成的指纹字符串
 * @param durationSec - 音频片段时长，单位为秒
 * @returns 最多三个候选，失败时返回网络错误
 */
export const matchAudio = async (
  fingerprint: string,
  durationSec: number,
): Promise<MatchResult> => {
  try {
    const response = await callNetease("audio_match", {
      audioFP: fingerprint,
      duration: durationSec,
    });
    const body = response.body as MatchResponse;
    if (body.code !== 200) {
      recognitionLog.error(`音频匹配接口错误: code=${body.code}`);
      return { ok: false, code: "network" };
    }
    const songs = (body.data?.result ?? [])
      .filter((item): item is { startTime?: number; song: MatchedSong } => !!item.song)
      .slice(0, 3)
      .map((item) => ({ song: item.song, startTime: item.startTime }));
    return { ok: true, songs };
  } catch (error) {
    recognitionLog.error("音频匹配请求失败:", error);
    return { ok: false, code: "network" };
  }
};
