/**
 * 插件系统 IPC
 *
 * 渲染端通过 `window.api.plugins.*` 调用以下 channel：
 * - plugin:list / install / pickAndInstall / installFromUrl / uninstall / setEnabled
 * - plugin:search / resolveUrl
 * 并订阅 `plugin:status` 广播以更新 UI。
 */

import { ipcMain, dialog, net } from "electron";
import type { PluginInfo } from "@shared/types/plugin";
import { INSTALL_URL_MAX_SIZE, INSTALL_URL_TIMEOUT } from "@shared/defaults/plugin-api";
import { pluginRegistry } from "@main/plugins/registry";
import { resolveUrl } from "@main/plugins/router";
import { broadcast } from "@main/utils/broadcast";
import { coreLog } from "@main/utils/logger";

/** 从 URL 拉取脚本源码，带大小与超时限制 */
const fetchScriptFromUrl = async (url: string): Promise<string> => {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`protocol not allowed: ${parsed.protocol}`);
  }
  const resp = await net.fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(INSTALL_URL_TIMEOUT),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  // Content-Length 预检（仅提示，不强信任）
  const lenHeader = resp.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > INSTALL_URL_MAX_SIZE) {
    throw new Error("PLUGIN_INSTALL_URL_TOO_LARGE");
  }
  const buf = await resp.arrayBuffer();
  if (buf.byteLength > INSTALL_URL_MAX_SIZE) {
    throw new Error("PLUGIN_INSTALL_URL_TOO_LARGE");
  }
  return new TextDecoder("utf-8").decode(buf);
};

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

  // 从远端 URL 下载并安装
  ipcMain.handle("plugin:installFromUrl", async (_evt, url: string) => {
    try {
      const source = await fetchScriptFromUrl(url);
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

  ipcMain.handle("plugin:resolveUrl", async (_evt, args) => {
    return resolveUrl(args);
  });

  // 状态变化广播
  pluginRegistry.on("status", (info: PluginInfo) => {
    broadcast("plugin:status", info);
  });
};
