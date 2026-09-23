import { qqmusicCall } from "@/apis/qqmusic";
import type { PlatformProfile } from "@shared/types/platform";
import type { QrLoginAdapter, QrLoginState } from "./platform";

interface UserDetailResponse {
  code: number;
  loggedIn: boolean;
  message?: string;
  profile?: PlatformProfile;
}

interface QmQrKeyResponse {
  code: number;
  key: string;
  content: string;
  type: string;
}

interface QmQrCheckResponse {
  code: number;
  status: number;
  nickname?: string;
  avatarUrl?: string;
}

/**
 * 创建 QM 扫码适配器
 * @param type 扫码类型，'qq' 或 'wx'
 */
const createQmQrAdapter = (type: "qq" | "wx"): QrLoginAdapter => ({
  create: async () => {
    const res = await qqmusicCall<QmQrKeyResponse>("login_qr_key", { type, timestamp: Date.now() });
    return { key: res.key, content: res.content };
  },
  check: async (key: string) => {
    const res = await qqmusicCall<QmQrCheckResponse>("login_qr_check", {
      key,
      type,
      timestamp: Date.now(),
    });
    const state: QrLoginState =
      res.status === 0
        ? "expired"
        : res.status === 2
          ? "scanned"
          : res.status === 4
            ? "success"
            : "waiting";
    return { state, nickname: res.nickname, avatarUrl: res.avatarUrl };
  },
});

/** QQ 扫码登录适配器 */
export const qqmusicQrLoginAdapter: QrLoginAdapter = createQmQrAdapter("qq");

/** 微信扫码登录适配器 */
export const qqmusicWxQrLoginAdapter: QrLoginAdapter = createQmQrAdapter("wx");

/**
 * 获取当前 QM 登录状态与用户资料
 * @returns 已登录返回 profile，未登录返回 null
 */
export const fetchQQMusicLoginStatus = async (): Promise<PlatformProfile | null> => {
  try {
    const data = await qqmusicCall<UserDetailResponse>("user_detail", {
      timestamp: Date.now(),
    });
    if (data?.code === 200 && data.loggedIn && data.profile) {
      return data.profile;
    }
    return null;
  } catch (err) {
    console.warn("[qqmusic] fetch login status failed:", err);
    return null;
  }
};

/**
 * 清除 QM 登录会话（登出）
 */
export const logoutQQMusic = async (): Promise<void> => {
  await window.api.apis.clearSession("qqmusic");
};

/**
 * 手动设置 QM Cookie
 * @param cookieString Cookie 字符串
 */
export const setQQMusicCookie = async (cookieString: string): Promise<boolean> => {
  const res = await window.api.apis.setCookie("qqmusic", cookieString);
  return res.ok;
};
