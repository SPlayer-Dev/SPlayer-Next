/**
 * QS 歌词（逐字）
 *
 * 端点：api.qishui.com/luna/pc/track_v2，取 lyric.content 原样返回（不做格式转换）。
 */

import { qsRequest } from "../core/request";
import { QS_TRACK_URL } from "../core/config";
import type { QSModule } from "../core/types";

interface QSTrackV2Resp {
  lyric?: { content?: string };
}

const lyric: QSModule = async (params) => {
  const { id } = params as { id?: string };
  if (!id) return { code: 400, message: "id required" };

  const data = await qsRequest<QSTrackV2Resp>(QS_TRACK_URL, {
    track_id: String(id),
    media_type: "track",
  });

  const content = data.lyric?.content?.trim();
  return { code: 200, content: content || undefined };
};

export default lyric;
