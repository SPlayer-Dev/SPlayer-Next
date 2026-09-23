import type { Track } from "@shared/types/player";
import { ErrorCode } from "@shared/types/errors";
import { getQualityLevel, type QualityLevel } from "@/utils/quality";
import { kugouCall } from "@/apis/kugou";

export type KugouPlayUrlResult =
  { available: true; url: string; isTrial: boolean } | { available: false; errorCode: ErrorCode };

interface SongUrlResponse {
  code: number;
  data?: { url?: string };
}

const QUALITY_ORDER: QualityLevel[] = ["lq", "sq", "hq", "lossless", "hi-res"];

const clampQuality = (requested: QualityLevel, track: Track): QualityLevel => {
  const available = getQualityLevel(track.quality);
  return QUALITY_ORDER[
    Math.min(QUALITY_ORDER.indexOf(requested), QUALITY_ORDER.indexOf(available))
  ];
};

export const resolveKugouUrl = async (
  track: Track,
  level: QualityLevel,
): Promise<KugouPlayUrlResult> => {
  try {
    const result = await kugouCall<SongUrlResponse>("song_url", {
      hash: track.id,
      audioId: track.extId,
      albumId: track.album?.id,
      level: clampQuality(level, track),
    });
    if (result.code === 200 && result.data?.url) {
      return { available: true, url: result.data.url, isTrial: false };
    }
  } catch (error) {
    console.warn("[kugou] resolve URL failed:", error);
  }
  return { available: false, errorCode: ErrorCode.URL_RESOLVE_FAILED };
};
