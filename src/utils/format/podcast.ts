import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import type { NeteaseDjProgram, NeteaseDjRadio } from "@/types/netease";
import type { Podcast } from "@/types/podcast";
import { songToTrack, withPicSize } from "./netease";

/** 网易云播客 → 应用层播客摘要 */
export const toPodcast = (radio: NeteaseDjRadio): Podcast => ({
  id: String(radio.id),
  name: radio.name,
  cover: withPicSize(radio.picUrl),
  description: radio.desc,
  creator: radio.dj?.nickname,
  programCount: radio.programCount ?? 0,
  createTime: radio.createTime,
  updateTime: radio.lastProgramCreateTime,
});

/** 播客摘要 → 封面卡片 */
export const podcastToCoverItem = (podcast: Podcast): CoverItem => ({
  id: podcast.id,
  title: podcast.name,
  cover: podcast.cover,
  subtitle: podcast.creator ?? "",
  trackCount: podcast.programCount,
});

/** 网易云播客节目 → 可播放曲目 */
export const podcastProgramToTrack = (
  program: NeteaseDjProgram,
  fallbackRadio?: NeteaseDjRadio,
): Track => {
  const radio = program.radio ?? fallbackRadio;
  const mainSong = program.mainSong;
  const base: Track = mainSong
    ? songToTrack(mainSong)
    : {
        id: String(program.mainTrackId ?? program.voiceId ?? program.id),
        source: "netease",
        title: program.name,
        artists: [],
        duration: program.duration ?? 0,
      };
  const coverUrl = program.coverUrl ?? radio?.picUrl;
  const cover = withPicSize(coverUrl) ?? base.cover;
  const coverOriginal = withPicSize(coverUrl, 1024) ?? base.coverOriginal;
  const creator = program.dj?.nickname ?? radio?.dj?.nickname;
  const categoryId = Number(program.categoryId);

  return {
    ...base,
    extId: String(program.id),
    playbackSource: radio
      ? {
          id: String(radio.id),
          type: "radio",
          categoryId: Number.isFinite(categoryId) ? categoryId : undefined,
        }
      : base.playbackSource,
    title: program.name,
    artists: creator ? [{ name: creator }] : base.artists,
    album: radio
      ? {
          id: String(radio.id),
          name: radio.name,
          cover: withPicSize(radio.picUrl),
        }
      : base.album,
    duration: program.duration ?? base.duration,
    publishTime: program.createTime,
    playCount: program.listenerCount,
    likedCount: program.likedCount,
    cover,
    coverOriginal,
  };
};
