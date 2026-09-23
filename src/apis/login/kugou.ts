import { kugouCall } from "@/apis/kugou";
import type { PlatformProfile } from "@shared/types/platform";
import type { QrLoginAdapter, QrLoginState } from "./platform";

interface UserDetailResponse {
  code: number;
  loggedIn: boolean;
  profile?: PlatformProfile;
}

interface KugouQrKeyResponse {
  key: string;
  content: string;
}

interface KugouQrCheckResponse {
  status: number;
  nickname?: string;
  avatarUrl?: string;
}

export const kugouQrLoginAdapter: QrLoginAdapter = {
  create: async () => {
    const result = await kugouCall<KugouQrKeyResponse>("login_qr_key", {});
    return { key: result.key, content: result.content };
  },
  check: async (key) => {
    const result = await kugouCall<KugouQrCheckResponse>("login_qr_check", { key });
    const state: QrLoginState =
      result.status === 0
        ? "expired"
        : result.status === 2
          ? "scanned"
          : result.status === 4
            ? "success"
            : "waiting";
    return { state, nickname: result.nickname, avatarUrl: result.avatarUrl };
  },
};

export const fetchKugouLoginStatus = async (): Promise<PlatformProfile | null> => {
  try {
    const result = await kugouCall<UserDetailResponse>("user_detail", { timestamp: Date.now() });
    return result.loggedIn ? (result.profile ?? null) : null;
  } catch {
    return null;
  }
};

export const logoutKugou = async (): Promise<void> => {
  await window.api.apis.clearSession("kugou");
};

export const setKugouCookie = async (cookie: string): Promise<boolean> => {
  const result = await window.api.apis.setCookie("kugou", cookie);
  return result.ok;
};
