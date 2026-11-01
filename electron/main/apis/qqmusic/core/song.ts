import type { QMSong } from "@shared/types/platform/qqmusic";
import { formatSingerName } from "./config";

/** 搜索、专辑与歌手接口共用的上游歌曲结构 */
export interface QMAudioInfo {
  id?: number;
  mid?: string;
  title?: string;
  name?: string;
  interval?: number;
  singer?: Array<{ id?: number; mid?: string; name?: string }>;
  album?: { mid?: string; name?: string; title?: string; pmid?: string };
  /** 碟片索引，从 0 开始 */
  index_cd?: number;
  file?: {
    media_mid?: string;
    size_128mp3?: number;
    size_320mp3?: number;
    size_ape?: number;
    size_flac?: number;
    size_192ogg?: number;
    size_hires?: number;
    size_new?: number[];
    hires_sample?: number;
    hires_bitdepth?: number;
  };
  pay?: {
    pay_month?: number;
    pay_play?: number;
    price_album?: number;
  };
}

/**
 * 将 QM 上游歌曲转换为跨进程歌曲结构
 * @param song - 上游歌曲数据
 * @param albumMid - 专辑接口已知的专辑 MID
 * @returns 时长以毫秒表示的歌曲信息
 */
export const normalizeQMSong = (song: QMAudioInfo, albumMid = ""): QMSong => {
  const mid = song.album?.mid ?? albumMid;
  const pictureMid = mid || song.album?.pmid;
  return {
    id: String(song.id ?? ""),
    mid: song.mid ?? "",
    name: song.title ?? song.name ?? "",
    artist: formatSingerName(song.singer),
    artists: song.singer ?? [],
    album: song.album?.name || song.album?.title || "",
    albumMid: mid,
    disc: song.index_cd !== undefined ? song.index_cd + 1 : undefined,
    duration: (song.interval ?? 0) * 1000,
    mediaMid: song.file?.media_mid ?? "",
    pay: {
      payalbum: song.pay?.pay_month === 0 && (song.pay.price_album ?? 0) > 0 ? 1 : 0,
      payplay: song.pay?.pay_play ?? 0,
    },
    size128: song.file?.size_128mp3 ?? 0,
    size320: song.file?.size_320mp3 ?? 0,
    sizeApe: song.file?.size_ape ?? 0,
    sizeFlac: song.file?.size_flac ?? 0,
    sizeOgg: song.file?.size_192ogg ?? 0,
    sizeHiRes: song.file?.size_hires || song.file?.size_new?.[0] || 0,
    hiResSampleRate: song.file?.hires_sample ?? 0,
    hiResBitDepth: song.file?.hires_bitdepth ?? 0,
    cover: pictureMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${pictureMid}.jpg` : "",
    coverOriginal: pictureMid
      ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${pictureMid}.jpg`
      : "",
  };
};
