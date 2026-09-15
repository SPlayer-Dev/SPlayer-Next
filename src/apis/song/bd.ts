import type { Track } from "@shared/types/player";
import type { BdSongUrlResult } from "@shared/types/bd";
import { ErrorCode } from "@shared/types/errors";
import type { QualityLevel } from "@/utils/quality";
import { bdCall } from "@/apis/bd";

/**
 * 解析 BD 单曲的播放 URL
 * @param track - 待解析的 Track
 * @param songLevel - 音质偏好
 */
export const resolveBdUrl = async (
  track: Track,
  songLevel: QualityLevel,
): Promise<BdSongUrlResult> => {
  try {
    return await bdCall<BdSongUrlResult>("song_url", {
      id: track.id,
      level: songLevel,
      audios: track.bd?.audios ?? [],
      freeSign: track.bd?.freeSign ?? "",
    });
  } catch {
    return { available: false, errorCode: ErrorCode.URL_RESOLVE_FAILED };
  }
};
