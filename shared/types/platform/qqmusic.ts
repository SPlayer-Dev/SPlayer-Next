/** QM 接口归一化后供主进程与渲染层共用的数据结构 */
export interface QMSong {
  id: string;
  mid?: string;
  mediaMid?: string;
  name: string;
  artist: string;
  artists?: Array<{ mid?: string; name?: string }>;
  album?: string;
  albumMid?: string;
  cover?: string;
  coverOriginal?: string;
  /** 歌曲时长，单位为毫秒 */
  duration: number;
  pay?: {
    payalbum?: number;
    payplay?: number;
  };
  size128?: number;
  size320?: number;
  sizeApe?: number;
  sizeFlac?: number;
  sizeOgg?: number;
  sizeHiRes?: number;
  hiResSampleRate?: number;
  hiResBitDepth?: number;
}

export interface QMAlbumItem {
  id: string;
  name: string;
  cover?: string;
  artist?: string;
  artistMid?: string;
  trackCount?: number;
  publishTime?: string;
}

export interface QMArtistItem {
  id: string;
  name: string;
  cover?: string;
  albumCount?: number;
  songCount?: number;
}

export interface QMPlaylistItem {
  id: string;
  name: string;
  cover?: string;
  creator?: string;
  trackCount?: number;
  playCount?: number;
}
