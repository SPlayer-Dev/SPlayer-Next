import { kgGatewayRequest } from "../core/request";
import type { KGModule } from "../core/types";

/** 获取 KG 歌曲精彩评论 */
const comment: KGModule = async (params) => {
  return kgGatewayRequest("/mcomment/v1/cmtlist", {
    method: "POST",
    params: {
      mixsongid: params.id,
      need_show_image: 1,
      p: params.page ?? 1,
      pagesize: params.limit ?? 20,
      show_classify: 0,
      show_hotword_list: 0,
      extdata: "0",
      code: "fc4be23b4e972707f36b8a828a93ba8a",
    },
  });
};

export default comment;
