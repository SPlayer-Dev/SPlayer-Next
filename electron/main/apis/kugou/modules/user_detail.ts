import type { KGModule } from "../core/types";
import { getSessionCookies, saveSessionCookies } from "@main/database/sessions";
import { kgGatewayRequest } from "../core/request";
import { rsaEncryptKugou } from "../core/crypto";

interface UserDetailData {
  userid?: number | string;
  nickname?: string;
  username?: string;
  user_name?: string;
  pic?: string;
  userpic?: string;
  user_pic?: string;
  avatar?: string;
  vip_type?: number;
}

const userDetail: KGModule = async () => {
  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) return { code: 200, loggedIn: false };
  const clienttime = Math.floor(Date.now() / 1000);
  const response = await kgGatewayRequest<{ data?: UserDetailData }>("/v3/get_my_info", {
    method: "POST",
    data: {
      visit_time: clienttime,
      usertype: 1,
      p: rsaEncryptKugou({ token: session.token, clienttime }).toUpperCase(),
      userid: Number(session.userid),
    },
    params: { plat: 1 },
    headers: { "x-router": "usercenter.kugou.com" },
  });
  const data = response.data ?? {};
  const nickname = data.nickname ?? data.username ?? data.user_name ?? session.nickname;
  const avatar = data.pic ?? data.userpic ?? data.user_pic ?? data.avatar ?? session.avatar;
  // vip_type 只反映标准版会员；概念版（含签到领取的会员）查 union_vip
  let isVip = Number(data.vip_type ?? 0) > 0;
  if (!isVip) {
    const unionResp = await kgGatewayRequest<{
      data?: { busi_vip?: Array<{ is_vip?: number }> };
    }>("/v1/get_union_vip", {
      baseURL: "https://kugouvip.kugou.com",
      params: { busi_type: "concept" },
    }).catch(() => null);
    isVip = unionResp?.data?.busi_vip?.[0]?.is_vip === 1;
  }
  const nextSession: Record<string, string> = {
    ...session,
    ...(nickname ? { nickname: String(nickname) } : {}),
    ...(avatar ? { avatar: String(avatar).replace(/^http:\/\//, "https://") } : {}),
    ...(data.vip_type !== undefined ? { vip_type: String(data.vip_type) } : {}),
  };
  saveSessionCookies("kugou", nextSession);
  return {
    code: 200,
    loggedIn: true,
    profile: {
      userId: session.userid,
      nickname: nextSession.nickname || `KG ${session.userid}`,
      avatarUrl: nextSession.avatar || "",
      isVip,
      vipLevel: Number(nextSession.vip_type || 0),
    },
  };
};

export default userDetail;
