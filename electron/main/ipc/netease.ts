/**
 * Netease API IPC
 *
 * 暴露一个通用入口 `netease:call`，参数为 (name, params)。
 * 响应形状对齐 interface.d.ts 的 Response：`{ status, body }`。
 * Cookie 完全由主进程 service 维护，渲染端不直接碰。
 */

import { ipcMain } from "electron";
import { callNetease, clearNeteaseCookies } from "@main/apis/netease";
import { coreLog } from "@main/utils/logger";

export const registerNeteaseIpc = (): void => {
  ipcMain.handle(
    "netease:call",
    async (_evt, name: string, params?: Record<string, unknown>) => {
      try {
        const res = await callNetease(name, params ?? {});
        return { ok: true, status: res.status, body: res.body };
      } catch (err) {
        coreLog.warn(`[netease] call ${name} failed:`, err);
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle("netease:clearCookie", () => {
    clearNeteaseCookies();
  });
};
