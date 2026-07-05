/**
 * 热门评论
 * params:
 * - id 资源 id
 * - type 网易云资源类型前缀，歌曲为 R_SO_4_
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const comment_hot: NeteaseModule = (query, request) => {
  const type = query.type ?? "R_SO_4_";
  const data = {
    rid: query.id,
    limit: query.limit ?? 20,
    offset: query.offset ?? 0,
    beforeTime: query.before ?? 0,
  };
  return request(
    `/api/v1/resource/hotcomments/${type}${query.id}`,
    data,
    createOption(query, "weapi"),
  );
};

export default comment_hot;
