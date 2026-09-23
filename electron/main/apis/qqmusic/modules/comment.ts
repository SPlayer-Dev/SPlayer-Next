/** QM 歌曲评论 */

import { qmRequest } from "../core/request";
import type { QMModule } from "../core/types";

interface QMCommentItem {
  Avatar?: string;
  CmId?: string;
  Content?: string;
  EncryptUin?: string;
  Location?: string;
  Nick?: string;
  Pic?: string;
  PraiseNum?: number;
  PubTime?: number;
  ReplyCnt?: number;
  RepliedComments?: QMCommentItem[];
  SeqNo?: string;
  SubComments?: QMCommentItem[];
}

interface QMCommentResponse {
  CommentList?: {
    Comments?: QMCommentItem[];
    HasMore?: number;
    Total?: number;
  };
}

const comment: QMModule = async (params) => {
  const id = String(params.id ?? "");
  if (!id) return { code: 400, message: "id required" };
  const type = params.type === "new" ? "new" : "hot";
  const page = Math.max(1, Number(params.page ?? 1));
  const limit = Math.max(1, Number(params.limit ?? 20));
  const cursor = String(params.cursor ?? "");
  const requestParams = {
    BizType: 1,
    BizId: id,
    LastCommentSeqNo: cursor,
    PageSize: limit,
    PageNum: page - 1,
    PicEnable: 1,
    ...(type === "hot"
      ? { HotType: 1, WithAirborne: 0 }
      : { HashTagID: "", SelfSeeEnable: 1, AudioEnable: 1 }),
  };
  const data = await qmRequest<QMCommentResponse>(
    "music.globalComment.CommentRead",
    type === "hot" ? "GetHotCommentList" : "GetNewCommentList",
    requestParams,
    { session: false },
  );
  const list = data.CommentList;
  const comments = list?.Comments ?? [];
  return {
    code: 200,
    comments,
    total: list?.Total ?? comments.length,
    hasMore: list?.HasMore === 1,
    nextCursor: list?.HasMore === 1 ? (comments.at(-1)?.SeqNo ?? "") : undefined,
  };
};

export default comment;
