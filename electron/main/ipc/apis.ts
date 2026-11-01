/** 注册音源接口和会话管理的跨进程入口 */

import { ipcMain } from "electron";
import { clearNeteaseCookies, mergeNeteaseCookies } from "@main/apis/netease";
import { cookieToJson } from "@main/apis/netease/core/cookie";
import { clearQQMusicCookies, mergeQQMusicCookies } from "@main/apis/qqmusic";
import { clearKugouSession, mergeKugouSession } from "@main/apis/kugou";
import { openNeteaseLoginWindow } from "@main/window/login";
import { coreLog } from "@main/utils/logger";
import type { ApiPlatform } from "@shared/types/apis";
import { callPlatformApi } from "@main/services/platformApi";

/**
 * 注册平台接口的进程通信处理器
 */
export const registerApisIpc = (): void => {
  ipcMain.handle(
    "apis:call",
    async (_evt, platform: ApiPlatform, name: string, params?: Record<string, unknown>) => {
      return callPlatformApi(platform, name, params);
    },
  );

  ipcMain.handle("apis:clearSession", (_evt, platform: ApiPlatform) => {
    if (platform === "netease") clearNeteaseCookies();
    if (platform === "qqmusic") clearQQMusicCookies();
    if (platform === "kugou") clearKugouSession();
  });

  /** 打开官方网页登录，成功后把 cookies 合并写入 session */
  ipcMain.handle("apis:openLoginWeb", async (_evt, platform: ApiPlatform) => {
    try {
      if (platform === "netease") {
        const cookies = await openNeteaseLoginWindow();
        if (!cookies) return { ok: false, error: "canceled" };
        mergeNeteaseCookies(cookies);
        return { ok: true };
      }
      return { ok: false, error: "unsupported platform" };
    } catch (err) {
      coreLog.warn(`[apis] openLoginWeb ${platform} failed:`, err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** 手动写入 cookie 登录 */
  ipcMain.handle("apis:setCookie", (_evt, platform: ApiPlatform, raw: string) => {
    const parsed = cookieToJson(raw);
    if (platform === "netease") {
      if (!parsed.MUSIC_U) return { ok: false, error: "missing MUSIC_U" };
      mergeNeteaseCookies(parsed);
      return { ok: true };
    }
    if (platform === "qqmusic") {
      if (
        !parsed.uin &&
        !parsed.wxuin &&
        !parsed.p_uin &&
        !parsed.qm_keyst &&
        !parsed.qqmusic_key
      ) {
        return { ok: false, error: "missing uin or key" };
      }
      mergeQQMusicCookies(parsed);
      return { ok: true };
    }
    if (platform === "kugou") {
      if (!parsed.token || !parsed.userid) {
        return { ok: false, error: "missing token or userid" };
      }
      mergeKugouSession(parsed);
      return { ok: true };
    }
    return { ok: false, error: "unsupported platform" };
  });
};
