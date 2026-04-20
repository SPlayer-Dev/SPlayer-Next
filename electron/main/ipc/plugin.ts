/**
 * 插件系统 IPC
 *
 * 渲染端通过 `window.api.plugins.*` 调用以下 channel：
 * - plugin:list / install / uninstall / setEnabled
 * - plugin:search / resolveUrl
 * 并订阅 `plugin:status` 广播以更新 UI。
 */

import { ipcMain, dialog } from "electron";
import type { PluginInfo } from "@shared/types/plugin";
import { pluginRegistry } from "@main/plugins/registry";
import { searchAcrossPlugins, resolveUrl } from "@main/plugins/router";
import { broadcast } from "@main/utils/broadcast";
import { coreLog } from "@main/utils/logger";
import { getMainWindow } from "@main/window";

export const registerPluginIpc = (): void => {
  ipcMain.handle("plugin:list", (): PluginInfo[] => pluginRegistry.listInfo());

  ipcMain.handle("plugin:install", async (_evt, filePath: string) => {
    try {
      const info = await pluginRegistry.install(filePath);
      return { ok: true, id: info.manifest.id };
    } catch (err) {
      coreLog.warn("[plugin] install failed:", err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // 弹出原生文件选择框 → 安装选中的 .js 脚本
  ipcMain.handle("plugin:pickAndInstall", async () => {
    const win = getMainWindow();
    const res = win
      ? await dialog.showOpenDialog(win, {
          title: "选择插件脚本",
          filters: [{ name: "Plugin Script", extensions: ["js"] }],
          properties: ["openFile"],
        })
      : await dialog.showOpenDialog({
          title: "选择插件脚本",
          filters: [{ name: "Plugin Script", extensions: ["js"] }],
          properties: ["openFile"],
        });
    if (res.canceled || !res.filePaths[0]) return { ok: false, cancelled: true };
    try {
      const info = await pluginRegistry.install(res.filePaths[0]);
      return { ok: true, id: info.manifest.id };
    } catch (err) {
      coreLog.warn("[plugin] pickAndInstall failed:", err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("plugin:uninstall", async (_evt, id: string) => {
    try {
      await pluginRegistry.uninstall(id);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle(
    "plugin:setEnabled",
    async (_evt, id: string, enabled: boolean) => {
      await pluginRegistry.setEnabled(id, enabled);
    },
  );

  ipcMain.handle("plugin:search", async (_evt, args) => {
    return searchAcrossPlugins(args);
  });

  ipcMain.handle("plugin:resolveUrl", async (_evt, args) => {
    return resolveUrl(args);
  });

  // 状态变化广播
  pluginRegistry.on("status", (info: PluginInfo) => {
    broadcast("plugin:status", info);
  });
};
