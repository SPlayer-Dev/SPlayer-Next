/**
 * QS 搜索
 *
 * 端点：api.qishui.com/luna/pc/search/track
 * 返回 result_groups[].data[]，取 meta.item_type==="track" 的 entity.track。
 * duration 已是毫秒，直接透传。
 */

import { qsRequest } from "../core/request";
import { QS_SEARCH_URL, formatArtists } from "../core/config";
import type { QSModule } from "../core/types";

interface QSTrack {
  id: string;
  name?: string;
  duration?: number;
  artists?: Array<{ name?: string }>;
  album?: { name?: string };
}

interface QSSearchResp {
  result_groups?: Array<{
    data?: Array<{ meta?: { item_type?: string }; entity?: { track?: QSTrack } }>;
  }>;
}

const search: QSModule = async (params) => {
  const { keywords, limit = 25 } = params as { keywords?: string; limit?: number };
  if (!keywords) return { code: 400, songs: [], message: "keywords required" };

  const data = await qsRequest<QSSearchResp>(QS_SEARCH_URL, {
    q: keywords,
    search_method: "input",
    cnt: String(limit),
    cursor: "0",
  });

  const songs: Array<{
    id: string;
    name: string;
    artist: string;
    album: string;
    duration: number;
  }> = [];
  const seen = new Set<string>();
  for (const group of data.result_groups ?? []) {
    for (const item of group.data ?? []) {
      if (item.meta?.item_type !== "track") continue;
      const track = item.entity?.track;
      if (!track?.id || seen.has(track.id)) continue;
      seen.add(track.id);
      songs.push({
        id: track.id,
        name: track.name ?? "",
        artist: formatArtists(track.artists),
        album: track.album?.name ?? "",
        duration: track.duration ?? 0,
      });
    }
  }

  return { code: 200, songs };
};

export default search;
