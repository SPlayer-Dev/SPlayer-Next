import { bdCall } from "@/apis/bd";
import type { PlatformProfile } from "@shared/types/platform";
import type { QrLoginAdapter, QrLoginState } from "./platform";

interface UserDetailResponse {
  loggedIn: boolean;
  profile?: PlatformProfile;
}

interface BdQrKeyResponse {
  key: string;
  content: string;
}

interface BdQrCheckResponse {
  state: string;
  nickname?: string;
  avatarUrl?: string;
}

export const bdQrLoginAdapter: QrLoginAdapter = {
  create: async () => {
    const result = await bdCall<BdQrKeyResponse>("login_qr_key", {});
    return { key: result.key, content: result.content };
  },
  check: async (key) => {
    const result = await bdCall<BdQrCheckResponse>("login_qr_check", { key });
    const state: QrLoginState =
      result.state === "success"
        ? "success"
        : result.state === "waiting"
          ? "waiting"
          : result.state === "scanned"
            ? "scanned"
            : "expired";
    return { state, nickname: result.nickname, avatarUrl: result.avatarUrl };
  },
};

export const fetchBdLoginStatus = async (): Promise<PlatformProfile | null> => {
  try {
    const result = await bdCall<UserDetailResponse>("user_detail", { timestamp: Date.now() });
    return result.loggedIn ? (result.profile ?? null) : null;
  } catch {
    return null;
  }
};

export const logoutBd = async (): Promise<void> => {
  await window.api.apis.clearSession("bd");
};

export const setBdCookie = async (cookie: string): Promise<boolean> => {
  const result = await window.api.apis.setCookie("bd", cookie);
  return result.ok;
};
