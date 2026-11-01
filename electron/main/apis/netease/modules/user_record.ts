import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/**
 * 使用与网页一致的分页参数查询听歌排行
 * @param query - 用户标识、排行类型与分页参数，type 为一时查询最近一周
 * @param request - 公共请求入口
 * @returns 服务端原始排行响应，未进入列表的歌曲不代表播放次数为零
 */
const userRecord: NeteaseModule = (query, request) =>
  request(
    "/api/v1/play/record",
    {
      uid: query.uid,
      type: query.type ?? 0,
      offset: query.offset ?? 0,
      total: true,
      limit: query.limit ?? 120,
    },
    createOption(query, "weapi"),
  );

export default userRecord;
