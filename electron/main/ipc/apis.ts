/**
 * 音源 API 统一 IPC
 *
 * 只注册两个通道：
 * - apis:call(platform, name, params)   调用对应平台的任意接口
 * - apis:clearSession(platform)         清空某平台登录态
 */

import { ipcMain } from "electron";
import { callNetease, clearNeteaseCookies } from "@main/apis/netease";
import { callQQMusic } from "@main/apis/qqmusic";
import { callKugou } from "@main/apis/kugou";
import { coreLog } from "@main/utils/logger";
import type { ApiPlatform } from "@shared/types/apis";

/** 各平台的调用器：统一返回 `{ status?, body?, data? }` 由前端按需取 */
const dispatch = async (
  platform: ApiPlatform,
  name: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  switch (platform) {
    case "netease": {
      const res = await callNetease(name, params);
      return { status: res.status, body: res.body };
    }
    case "qqmusic": {
      const data = await callQQMusic(name, params);
      return { data };
    }
    case "kugou": {
      const data = await callKugou(name, params);
      return { data };
    }
    default:
      throw new Error(`unknown platform: ${platform}`);
  }
};

export const registerApisIpc = (): void => {
  ipcMain.handle(
    "apis:call",
    async (_evt, platform: ApiPlatform, name: string, params?: Record<string, unknown>) => {
      try {
        const result = await dispatch(platform, name, params ?? {});
        return { ok: true, ...result };
      } catch (err) {
        coreLog.warn(`[apis] ${platform}.${name} failed:`, err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle("apis:clearSession", (_evt, platform: ApiPlatform) => {
    if (platform === "netease") clearNeteaseCookies();
  });
};
