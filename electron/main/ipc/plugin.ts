/**
 * 插件系统 IPC
 *
 * 渲染端通过 `window.api.plugins.*` 调用以下 channel：
 * - plugin:list / install / pickAndInstall / installFromUrl / uninstall / setEnabled
 * - plugin:search / resolveUrl
 * 并订阅 `plugin:status` 广播以更新 UI。
 */

import { ipcMain, dialog } from "electron";
import type { PluginInfo } from "@shared/types/plugin";
import { pluginRegistry } from "@main/plugins/registry";
import { resolveUrl, invokeMenu } from "@main/plugins/router";
import { matchLyric, matchCover } from "@main/plugins/metadata";
import { fetchScript, fetchMarket } from "@main/plugins/net";
import { broadcast } from "@main/utils/broadcast";
import { coreLog } from "@main/utils/logger";

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
  // 注意：不要把主窗口作为 parent 传入，frameless 窗口 + 模态对话框会在 Windows 上卡死主窗
  ipcMain.handle("plugin:pickAndInstall", async () => {
    const res = await dialog.showOpenDialog({
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

  // 拉取插件市场索引
  ipcMain.handle("plugin:market", async () => {
    try {
      return { ok: true, plugins: await fetchMarket() };
    } catch (err) {
      coreLog.warn("[plugin] market fetch failed:", err);
      return { ok: false, plugins: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 从远端 URL 下载并安装
  ipcMain.handle("plugin:installFromUrl", async (_evt, url: string) => {
    try {
      const source = await fetchScript(url);
      const info = await pluginRegistry.installFromSource(source);
      return { ok: true, id: info.manifest.id };
    } catch (err) {
      coreLog.warn("[plugin] installFromUrl failed:", err);
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

  ipcMain.handle("plugin:setEnabled", async (_evt, id: string, enabled: boolean) => {
    await pluginRegistry.setEnabled(id, enabled);
  });

  ipcMain.handle("plugin:setSetting", async (_event, id: string, key: string, value: unknown) => {
    await pluginRegistry.setSetting(id, key, value);
  });

  // 手动检查更新：拉 @updateUrl(raw .js) 读其 @version 与本地比对，有新版则置 updateInfo
  ipcMain.handle("plugin:checkUpdate", async (_evt, id: string) => {
    try {
      return await pluginRegistry.checkUpdate(id);
    } catch (err) {
      coreLog.warn("[plugin] checkUpdate failed:", err);
      return {
        ok: false,
        hasUpdate: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // 一键更新：拉取 updateUrl(raw .js) 原地覆盖；失败回退到手动打开下载页
  ipcMain.handle("plugin:applyUpdate", async (_evt, id: string) => {
    const updateUrl = pluginRegistry.getUpdateUrl(id);
    if (!updateUrl) return { ok: false, error: "PLUGIN_NO_UPDATE_URL" };
    try {
      const source = await fetchScript(updateUrl);
      const plugin = await pluginRegistry.applyUpdateFromSource(id, source);
      return { ok: true, plugin };
    } catch (err) {
      coreLog.warn("[plugin] applyUpdate failed:", err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        fallbackUrl: updateUrl,
      };
    }
  });

  ipcMain.handle("plugin:resolveUrl", async (_evt, args) => {
    return resolveUrl(args);
  });

  ipcMain.handle("plugin:invokeMenu", async (_evt, args) => {
    try {
      const res = await invokeMenu(args);
      return { ok: true, toast: res?.toast, openUrl: res?.openUrl, copyText: res?.copyText };
    } catch (err) {
      coreLog.warn("[plugin] invokeMenu failed:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 插件兜底匹配歌词：内置三平台拿不到时由渲染端逐个插件源调用
  ipcMain.handle("plugin:matchLyric", async (_evt, args) => {
    const data = await matchLyric(args);
    return data ? { ok: true, data } : { ok: false };
  });

  // 插件兜底匹配封面：曲目无封面时由渲染端逐个插件源调用
  ipcMain.handle("plugin:matchCover", async (_evt, args) => {
    const data = await matchCover(args);
    return data ? { ok: true, data } : { ok: false };
  });

  // 状态变化广播
  pluginRegistry.on("status", (info: PluginInfo) => {
    broadcast("plugin:status", info);
  });
};
