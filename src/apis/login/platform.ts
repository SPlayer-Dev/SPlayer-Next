import type { Platform, PlatformProfile } from "@shared/types/platform";
import {
  fetchQQMusicLoginStatus,
  logoutQQMusic,
  qqmusicQrLoginAdapter,
  qqmusicWxQrLoginAdapter,
  setQQMusicCookie,
} from "./qqmusic";
import { fetchKugouLoginStatus, kugouQrLoginAdapter, logoutKugou, setKugouCookie } from "./kugou";

export type QrLoginState = "expired" | "waiting" | "scanned" | "success";

export interface QrLoginAdapter {
  create: () => Promise<{ key: string; content: string }>;
  check: (key: string) => Promise<{
    state: QrLoginState;
    nickname?: string;
    avatarUrl?: string;
  }>;
}

export interface QrLoginOption {
  key: string;
  labelKey: string;
  adapter: QrLoginAdapter;
}

export interface PlatformAccountAdapter {
  displayName: string;
  userIdLabel: string;
  fetchProfile: () => Promise<PlatformProfile | null>;
  logout: () => Promise<void>;
  openWebLogin?: () => Promise<boolean>;
  setCookie?: (cookie: string) => Promise<boolean>;
  qrLogin?: QrLoginAdapter;
  qrLoginOptions?: QrLoginOption[];
}

const adapters: Partial<Record<Platform, PlatformAccountAdapter>> = {
  qqmusic: {
    displayName: "QM",
    userIdLabel: "UIN",
    fetchProfile: fetchQQMusicLoginStatus,
    logout: logoutQQMusic,
    setCookie: setQQMusicCookie,
    qrLogin: qqmusicQrLoginAdapter,
    qrLoginOptions: [
      {
        key: "qq",
        labelKey: "settings.platformLogin.loginQrQQ",
        adapter: qqmusicQrLoginAdapter,
      },
      {
        key: "wx",
        labelKey: "settings.platformLogin.loginQrWX",
        adapter: qqmusicWxQrLoginAdapter,
      },
    ],
  },
  kugou: {
    displayName: "KG",
    userIdLabel: "ID",
    fetchProfile: fetchKugouLoginStatus,
    logout: logoutKugou,
    setCookie: setKugouCookie,
    qrLogin: kugouQrLoginAdapter,
  },
};

/**
 * 获取平台账号适配器
 * @param platform - 音乐平台
 * @returns 平台账号适配器
 */
export const getPlatformAccountAdapter = (platform: Platform): PlatformAccountAdapter => {
  const adapter = adapters[platform];
  if (!adapter) throw new Error(`平台暂不支持账号连接: ${platform}`);
  return adapter;
};
