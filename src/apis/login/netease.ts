/**
 * 登录相关
 */

import type { UserProfile } from "@/types/user";
import { netease as neteaseApi } from "@/apis/netease";
import type { QrLoginAdapter, QrLoginState } from "./platform";

interface LoginStatusBody {
  code?: number | string;
  data?: {
    profile?: Partial<UserProfile> & { userId?: number };
    account?: { id?: number };
  };
  profile?: Partial<UserProfile> & { userId?: number };
  account?: { id?: number };
}

/**
 * 生成扫码登录二维码 key
 * @returns 二维码 key
 */
export const qrKey = async (): Promise<string> => {
  const body = await neteaseApi.login_qr_key({ timestamp: Date.now() });
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
  const body = await neteaseApi.login_qr_check({ key, timestamp: Date.now() });
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

export const neteaseQrLoginAdapter: QrLoginAdapter = {
  create: async () => {
    const key = await qrKey();
    return { key, content: qrContent(key) };
  },
  check: async (key) => {
    const result = await qrCheck(key);
    const state: QrLoginState =
      result.code === 800
        ? "expired"
        : result.code === 802
          ? "scanned"
          : result.code === 803
            ? "success"
            : "waiting";
    return { state, nickname: result.nickname, avatarUrl: result.avatarUrl };
  },
};

/**
 * 校验 cookie 并取当前用户 profile
 * @returns 已登录返回 profile；未登录或 cookie 失效返回 null
 */
export const fetchLoginStatus = async (): Promise<UserProfile | null> => {
  const body = await neteaseApi.login_status<LoginStatusBody>({ timestamp: Date.now() });
  if (body?.code !== undefined && Number(body.code) !== 200) return null;
  const account = body?.data?.account ?? body?.account;
  const profile = body?.data?.profile ?? body?.profile;

  // 游客/匿名账号（anonimous 为 true、或无有效 profile/nickname）判定为未登录
  if (
    !account ||
    (account as { anonimous?: boolean }).anonimous ||
    !profile ||
    !profile.userId ||
    !profile.nickname
  ) {
    return null;
  }

  return {
    userId: profile.userId,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
    backgroundUrl: profile.backgroundUrl,
    signature: profile.signature,
    vipType: profile.vipType,
    gender: profile.gender,
    province: profile.province,
    city: profile.city,
  };
};

/**
 * 续期登录 cookie
 * set-cookie 由主进程 SESSION_MUTATING 自动写回 SQLite
 * @returns 服务端是否实际下发了新的登录 cookie
 */
export const refreshLogin = async (): Promise<boolean> => {
  const body = await neteaseApi.login_refresh<{ cookie?: unknown }>({ timestamp: Date.now() });
  return typeof body?.cookie === "string" && /(?:^|;)\s*MUSIC_U=/.test(body.cookie);
};

/** 服务端登出（仅打断 server session，不清本地 cookie） */
export const logoutNetease = async (): Promise<void> => {
  await neteaseApi.logout();
};
