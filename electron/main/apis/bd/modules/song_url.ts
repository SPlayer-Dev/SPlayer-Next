import type { BdAudio, BdSongUrlResult } from "../../../../../shared/types/bd";
import { ErrorCode } from "../../../../../shared/types/errors";
import { selectBdAudio } from "../../../../../shared/utils/bd";
import { BdApiError } from "../core/request";
import type { BdContext, BdParams } from "../core/types";

interface PlayRight {
  status: number;
  audition?: {
    https?: string;
    car_url_https?: string;
    url?: string;
    car_url?: string;
    format?: string;
  };
}

const playableUrl = (
  raw: string | undefined,
  format: string,
  isTrial: boolean,
): BdSongUrlResult => {
  if (raw) {
    const url = new URL(raw);
    const extension = url.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    const actualFormat = extension || format.toLowerCase();
    if (
      ["https:", "http:"].includes(url.protocol) &&
      ["mp3", "ogg", "flac", "aac", "m4a"].includes(actualFormat)
    ) {
      return { available: true, url: raw, format: actualFormat, isTrial };
    }
  }
  return { available: false, errorCode: ErrorCode.NETEASE_UNAVAILABLE };
};

export const songUrl = async (params: BdParams, context: BdContext): Promise<BdSongUrlResult> => {
  const session = context.getSession();
  if (!session.uid || session.uid === "-1" || !session.token) {
    return { available: false, errorCode: ErrorCode.NETEASE_LOGIN_EXPIRED };
  }
  const musicId = Number(params.id);
  if (!Number.isSafeInteger(musicId) || musicId <= 0) throw new Error("BD 歌曲 ID 无效");
  let freeSign = String(params.freeSign ?? "");
  try {
    freeSign = decodeURIComponent(freeSign);
  } catch {}
  try {
    const rightData = { musicId, freeSign };
    const right = await context.request<PlayRight>("/api/play/music/v2/checkRight", {
      params: rightData,
      data: rightData,
      signed: true,
      queryOnlySignature: true,
    });
    if (Number(right?.status) === 3) {
      const audition = right.audition ?? {};
      return playableUrl(
        audition.https || audition.car_url_https || audition.url || audition.car_url,
        audition.format || "mp3",
        true,
      );
    }
    if (![1, 4].includes(Number(right?.status))) {
      return { available: false, errorCode: ErrorCode.NETEASE_VIP_REQUIRED };
    }
    const level = String(params.level ?? "hq");
    if (!["lq", "sq", "hq", "lossless", "hi-res"].includes(level)) throw new Error("BD 音质无效");
    const audio = selectBdAudio(
      (params.audios ?? []) as BdAudio[],
      level as Parameters<typeof selectBdAudio>[1],
    );
    if (!audio) return { available: false, errorCode: ErrorCode.NETEASE_UNAVAILABLE };
    const audioData = {
      devId: session.devid,
      musicId,
      format: audio.format,
      br: `${audio.bitrate}k${audio.format}`,
      freeSign,
    };
    const data = await context.request<{ audioHttpsUrl?: string; audioUrl?: string }>(
      "/api/play/music/v2/audioUrl",
      {
        params: audioData,
        data: audioData,
        signed: true,
        queryOnlySignature: true,
        authHeaders: true,
      },
    );
    return playableUrl(data?.audioHttpsUrl || data?.audioUrl, audio.format, false);
  } catch (error) {
    if (error instanceof BdApiError && (error.code === 11027 || error.code === 401)) {
      return { available: false, errorCode: ErrorCode.NETEASE_LOGIN_EXPIRED };
    }
    throw error;
  }
};
