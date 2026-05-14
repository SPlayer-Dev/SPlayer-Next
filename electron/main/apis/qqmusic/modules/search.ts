/**
 * QM 搜索
 *
 * 端点：musicu.fcg / SearchCgiService / DoSearchForQQMusicMobile
 */

import { qmRequest } from "../core/request";
import { formatSingerName } from "../core/config";
import type { QMModule } from "../core/types";

/** 移动端随机 search_id */
const genSearchId = (): string =>
  String(
    Math.floor(Math.random() * 20) * 18014398509481984 +
      Math.floor(Math.random() * 4194304) * 4294967296 +
      (Date.now() % 86400000),
  );

interface QMSong {
  id: number;
  mid: string;
  title: string;
  interval: number;
  singer?: Array<{ id?: number; mid?: string; name?: string }>;
  album?: { id?: number; mid?: string; name?: string };
  file?: { media_mid?: string };
}
interface SongsResp {
  body?: { item_song?: QMSong[] };
  meta?: { sum?: number; estimate_sum?: number; nextpage?: number };
}

const searchSongs = async (keywords: string, page: number, limit: number) => {
  const data = await qmRequest<SongsResp>(
    "music.search.SearchCgiService",
    "DoSearchForQQMusicMobile",
    {
      search_id: genSearchId(),
      remoteplace: "search.android.keyboard",
      query: keywords,
      search_type: 0,
      num_per_page: limit,
      page_num: page,
      highlight: 0,
      nqc_flag: 0,
      multi_zhida: 0,
      cat: 2,
      grp: 1,
      sin: 0,
      sem: 0,
      page_id: 1,
    },
  );

  const songs = (data?.body?.item_song ?? []).map((song) => ({
    id: String(song.id),
    mid: song.mid,
    name: song.title,
    artist: formatSingerName(song.singer),
    album: song.album?.name ?? "",
    albumMid: song.album?.mid ?? "",
    duration: (song.interval ?? 0) * 1000,
    mediaMid: song.file?.media_mid ?? "",
  }));

  const total = data?.meta?.estimate_sum ?? data?.meta?.sum ?? songs.length;
  return { code: 200, total, songs };
};

const search: QMModule = async (params) => {
  const {
    keywords,
    page = 1,
    limit = 30,
    type = 0,
  } = params as {
    keywords?: string;
    page?: number;
    limit?: number;
    type?: number;
  };

  if (!keywords) return { code: 400, total: 0, message: "keywords required" };

  // 仅单曲；其他类型由渲染端返回空
  if (type !== 0) return { code: 200, total: 0 };

  return searchSongs(keywords, page, limit);
};

export default search;
