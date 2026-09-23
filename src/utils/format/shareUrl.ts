import type { Track, TrackSource } from "@shared/types/player";
import type { Collection, CollectionType } from "@/types/collection";

/**
 * 取在线平台的歌曲分享链接
 * @param track - 当前歌曲，本地/流媒体/不支持平台返回 null
 */
export const getTrackShareUrl = (track: Track | null | undefined): string | null => {
  if (!track?.id) return null;
  switch (track.source) {
    case "netease":
      return `https://music.163.com/#/song?id=${track.id}`;
    case "qqmusic":
      return `https://y.qq.com/n/ryqq_v2/songDetail/${track.id}`;
    case "kugou":
      return `https://www.kugou.com/mixsong/${track.id}.html`;
    default:
      return null;
  }
};

/**
 * 取在线平台的歌曲合集分享链接
 * @param collection - 当前歌曲合集，本地/流媒体/不支持平台返回 null
 */
export const getCollectionShareUrl = (collection: Collection | null | undefined): string | null => {
  if (!collection?.id) return null;
  const urls: Record<CollectionType, Record<TrackSource, string | null>> = {
    album: {
      netease: `https://music.163.com/#/album?id=${collection.id}`,
      qqmusic: `https://y.qq.com/n/ryqq_v2/albumDetail/${collection.id}`,
      kugou: `https://www.kugou.com/album/info/${collection.id}/`,
      streaming: null,
      local: null,
    },
    playlist: {
      netease: `https://music.163.com/#/playlist?id=${collection.id}`,
      qqmusic: `https://y.qq.com/n/ryqq_v2/playlist/${collection.id}`,
      kugou: `https://www.kugou.com/songlist/${collection.id}/`,
      streaming: null,
      local: null,
    },
    radio: {
      netease: `https://music.163.com/#/djradio?id=${collection.id}`,
      qqmusic: `https://y.qq.com/n/ryqq_v2/player_radio#id=${collection.id}`,
      kugou: `https://www.kugou.com/song/#fm_id=${collection.id}`,
      streaming: null,
      local: null,
    },
    cloud: {
      netease: null,
      qqmusic: null,
      kugou: null,
      streaming: null,
      local: null,
    },
  };
  return urls[collection.type]?.[collection.source] ?? null;
};
