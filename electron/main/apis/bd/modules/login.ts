import type { PlatformProfile } from "../../../../../shared/types/platform";
import type { BdContext, BdModule } from "../core/types";

interface LoginData {
  id?: string | number;
  uid?: string | number;
  userId?: string | number;
  token?: string;
  userToken?: string;
  status?: number;
  userInfo?: {
    nickname?: string;
    headImg?: string;
    avatar?: string;
    pic?: string;
    isVip?: number;
    vipType?: number;
  };
  payInfo?: { isVipBoolean?: boolean; vipType?: number };
}

const applyLogin = (data: LoginData, context: BdContext): PlatformProfile => {
  const userId = String(data.id ?? data.uid ?? data.userId ?? "");
  const token = data.token || data.userToken;
  if (!/^[1-9]\d*$/.test(userId) || !token) throw new Error("BD 登录响应缺少 UID 或 Token");
  const userInfo = data.userInfo ?? {};
  const profile: PlatformProfile = {
    userId,
    nickname: userInfo.nickname || `BD ${userId}`,
    avatarUrl: userInfo.headImg || userInfo.avatar || userInfo.pic || "",
    isVip: data.payInfo?.isVipBoolean === true || Number(userInfo.isVip) === 1,
    vipLevel: Number(data.payInfo?.vipType ?? userInfo.vipType ?? 0),
  };
  context.saveSession({ uid: userId, token, profile: JSON.stringify(profile) });
  return profile;
};

export const loginQrKey: BdModule = async (_params, context) => {
  const data = await context.request<{ qrCode: string }>("/api/ucenter/login/qrCode", {
    anonymous: true,
    signed: true,
  });
  if (!data?.qrCode) throw new Error("BD 二维码获取失败");
  return {
    key: String(data.qrCode),
    content: `https://bd-oia.kuwo.cn/bd/download.html?pageName=login_pc&pt=3&id=${encodeURIComponent(data.qrCode)}`,
  };
};

export const loginQrCheck: BdModule = async (params, context) => {
  const key = String(params.key ?? "");
  if (!key) throw new Error("BD 二维码缺失");
  const status = await context.request<LoginData>("/api/ucenter/login/qrCodeStatus", {
    params: { qrCode: key },
    anonymous: true,
    signed: true,
  });
  const statusCode = Number(status?.status);
  if (statusCode === 1) return { state: "waiting" };
  if (statusCode === 2) return { state: "scanned" };
  if (statusCode !== 3) {
    return { state: "expired" };
  }
  const data =
    status.token || status.userToken
      ? status
      : await context.request<LoginData>("/api/ucenter/users/login", {
          method: "POST",
          anonymous: true,
          signed: true,
          data: { authType: 10, qrCode: key },
        });
  const profile = applyLogin(data, context);
  return { state: "success", nickname: profile.nickname, avatarUrl: profile.avatarUrl };
};

export const userDetail: BdModule = async (_params, context) => {
  const session = context.getSession();
  if (!session.uid || session.uid === "-1" || !session.token) return { loggedIn: false };
  if (session.profile) {
    try {
      const profile = JSON.parse(session.profile) as PlatformProfile;
      if (profile.userId) return { loggedIn: true, profile };
    } catch {}
  }
  return {
    loggedIn: true,
    profile: {
      userId: session.uid,
      nickname: `BD ${session.uid}`,
      avatarUrl: "",
      isVip: false,
    },
  };
};
