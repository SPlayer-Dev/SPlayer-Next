import type { UserProfile } from "@/types/user";
import { clearNeteaseSession } from "@/apis/netease";
import {
  fetchLoginStatus,
  refreshLogin as refreshLoginApi,
  logoutNetease,
} from "@/apis/login/netease";

/** 保活间隔 */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const useUserStore = defineStore(
  "user",
  () => {
    /** 用户基础资料 */
    const profile = ref<UserProfile | null>(null);
    /** 上一次 login_refresh 时间戳（毫秒） */
    const lastRefreshAt = ref<number>(0);
    /** 是否已登录 */
    const isLoggedIn = computed(() => profile.value !== null);

    /**
     * 用给定 profile 填充登录态
     * @param newProfile 用户基础资料
     */
    const setProfile = (newProfile: UserProfile | null): void => {
      profile.value = newProfile;
      if (newProfile) lastRefreshAt.value = Date.now();
      else lastRefreshAt.value = 0;
    };

    /** 后台续期 cookie，失败静默 */
    const refresh = async (): Promise<void> => {
      try {
        await refreshLoginApi();
        lastRefreshAt.value = Date.now();
      } catch {}
    };

    /** 校验 cookie 并同步最新 profile */
    const fetchStatus = async (): Promise<boolean> => {
      try {
        const latest = await fetchLoginStatus();
        if (latest) {
          profile.value = latest;
          if (Date.now() - lastRefreshAt.value > REFRESH_INTERVAL_MS) {
            void refresh();
          }
          return true;
        }
        profile.value = null;
        lastRefreshAt.value = 0;
        return false;
      } catch {
        // 网络失败保留缓存的 profile，不强制登出（离线可用性）
        return profile.value !== null;
      }
    };

    /** 登出：服务端清会话 + 主进程清 cookie + 本地清 profile */
    const logout = async (): Promise<void> => {
      try {
        await logoutNetease();
      } catch {
        /* 忽略：即使服务端登出失败也要清本地 */
      }
      await clearNeteaseSession();
      profile.value = null;
      lastRefreshAt.value = 0;
    };

    return { profile, lastRefreshAt, isLoggedIn, setProfile, fetchStatus, logout };
  },
  {
    persist: {
      storage: localStorage,
      pick: ["profile", "lastRefreshAt"],
    },
  },
);
