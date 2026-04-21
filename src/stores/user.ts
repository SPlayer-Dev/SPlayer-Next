/**
 * 用户登录态 Store
 *
 * - cookie 由主进程维护，这里只缓存"展示用"的 profile
 * - `isLoggedIn` 由 `profile != null` 派生
 * - 启动时通过 `fetchStatus()` 向 Netease 校验 cookie 是否仍有效
 */

import { neteaseCall } from "@/apis/netease";

/** 用户基础资料（对齐 Netease /login/status 返回的关键字段） */
export interface UserProfile {
  userId: number;
  nickname: string;
  avatarUrl?: string;
  backgroundUrl?: string;
  signature?: string;
  /** 0=普通会员，非 0=黑胶 VIP（具体级别见官方文档） */
  vipType?: number;
  gender?: number;
  province?: number;
  city?: number;
}

interface LoginStatusBody {
  data?: {
    code?: number;
    account?: { id?: number } | null;
    profile?: (Partial<UserProfile> & { userId?: number }) | null;
  };
}

export const useUserStore = defineStore(
  "user",
  () => {
    const profile = ref<UserProfile | null>(null);
    const isLoggedIn = computed(() => profile.value !== null);

    /** 用给定 profile 填充登录态（一般由登录成功回调调用） */
    const setProfile = (p: UserProfile | null): void => {
      profile.value = p;
    };

    /** 调 /login/status 校验 cookie 并同步最新 profile；失效则清空 */
    const fetchStatus = async (): Promise<boolean> => {
      try {
        const body = await neteaseCall<LoginStatusBody>("login_status");
        const data = body?.data;
        const p = data?.profile;
        if (p?.userId) {
          profile.value = {
            userId: p.userId,
            nickname: p.nickname ?? "",
            avatarUrl: p.avatarUrl,
            backgroundUrl: p.backgroundUrl,
            signature: p.signature,
            vipType: p.vipType,
            gender: p.gender,
            province: p.province,
            city: p.city,
          };
          return true;
        }
        profile.value = null;
        return false;
      } catch {
        // 网络失败时保留缓存的 profile，不强制登出（离线可用性）
        return profile.value !== null;
      }
    };

    /** 登出：服务端清会话 + 主进程清 cookie + 本地清 profile */
    const logout = async (): Promise<void> => {
      try {
        await neteaseCall("logout");
      } catch {
        /* 忽略：即使服务端登出失败也要清本地 */
      }
      await window.api.netease.clearCookie();
      profile.value = null;
    };

    return { profile, isLoggedIn, setProfile, fetchStatus, logout };
  },
  {
    persist: {
      storage: localStorage,
      // 只持久化 profile；cookie 在主进程自管
      pick: ["profile"],
    },
  },
);
