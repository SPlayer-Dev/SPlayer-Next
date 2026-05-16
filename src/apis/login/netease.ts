/**
 * 网易云登录相关
 */

import type { UserProfile } from "@/types/user";
import { netease as neteaseApi } from "@/apis/netease";

interface QrKeyResp {
  data?: { unikey?: string };
}

interface QrCheckResp {
  code?: number;
  cookie?: string;
  nickname?: string;
  avatarUrl?: string;
  message?: string;
}

interface LoginStatusBody {
  data?: {
    code?: number;
    account?: { id?: number } | null;
    profile?: (Partial<UserProfile> & { userId?: number }) | null;
  };
}

/**
 * 生成扫码登录二维码 key
 * @returns 二维码 key
 */
export const qrKey = async (): Promise<string> => {
  const body = await neteaseApi.login_qr_key<QrKeyResp>({ timestamp: Date.now() });
  const unikey = body?.data?.unikey;
  if (!unikey) throw new Error("qr key missing");
  return unikey;
};

export type QrStatusCode = 800 | 801 | 802 | 803;

export interface QrCheckResult {
  code: QrStatusCode;
  cookie?: string;
  nickname?: string;
  avatarUrl?: string;
}

/**
 * 轮询扫码状态
 * - 800 已过期 / 801 待扫码 / 802 待确认 / 803 已确认（含 cookie）
 * @param key 二维码 key
 * @returns 扫码状态和结果
 */
export const qrCheck = async (key: string): Promise<QrCheckResult> => {
  const body = await neteaseApi.login_qr_check<QrCheckResp>({ key, timestamp: Date.now() });
  const code = (body?.code ?? 801) as QrStatusCode;
  return {
    code,
    cookie: body?.cookie,
    nickname: body?.nickname,
    avatarUrl: body?.avatarUrl,
  };
};

/**
 * 二维码内容
 * @param key 二维码 key
 * @returns 二维码内容
 */
export const qrContent = (key: string): string => `https://music.163.com/login?codekey=${key}`;

/**
 * 校验 cookie 并取当前用户 profile
 * @returns 已登录返回 profile；未登录或 cookie 失效返回 null
 */
export const fetchLoginStatus = async (): Promise<UserProfile | null> => {
  const body = await neteaseApi.login_status<LoginStatusBody>();
  const raw = body?.data?.profile;
  if (!raw?.userId) return null;
  return {
    userId: raw.userId,
    nickname: raw.nickname ?? "",
    avatarUrl: raw.avatarUrl,
    backgroundUrl: raw.backgroundUrl,
    signature: raw.signature,
    vipType: raw.vipType,
    gender: raw.gender,
    province: raw.province,
    city: raw.city,
  };
};

/**
 * 续期登录 cookie
 * set-cookie 由主进程 SESSION_MUTATING 自动写回 SQLite
 */
export const refreshLogin = async (): Promise<void> => {
  await neteaseApi.login_refresh();
};

/** 服务端登出（仅打断 server session，不清本地 cookie） */
export const logoutNetease = async (): Promise<void> => {
  await neteaseApi.logout();
};
