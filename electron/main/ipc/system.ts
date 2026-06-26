import { app, ipcMain, shell } from "electron";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { getFonts } from "font-list";
import type { LocaleCode } from "@shared/types/settings";
import { setLocale } from "@main/utils/i18n";
import { systemLog } from "@main/utils/logger";
import { refreshTray } from "@main/services/tray";
import { getThumbar } from "@main/services/thumbar";
import { getMainWindow, focusMainWindow } from "@main/window";
import { fetchBytes } from "@main/utils/fetchBytes";
import { logsDir } from "@main/utils/paths";
import { consumePendingOrpheusUrl } from "@main/services/orpheus";

/**
 * 任务栏封面点击 toggle 状态
 * 记录呼出前的窗口状态，再次点击时恢复（最小化/后台）
 * 渲染端手动收起播放界面时通过 resetPlayingViewToggle 重置
 */
let taskbarPrevState: "minimized" | "unfocused" | null = null;

/**
 * 主窗口播放界面是否展开（渲染端同步过来）
 * 用于任务栏封面 toggle：已展开且窗口聚焦 → 再次点击收起
 */
let playingViewExpanded = false;

/**
 * 注册系统相关的 IPC 事件
 */
export const registerSystemIpc = (): void => {
  ipcMain.on("ping", () => systemLog.debug("pong"));

  // 渲染层拉取冷启动暂存的 orpheus 唤起 URL
  ipcMain.handle("system:consumePendingProtocolUrl", () => consumePendingOrpheusUrl());

  // 切换开发者工具
  ipcMain.handle("system:toggleDevTools", () => {
    const win = getMainWindow();
    if (win) {
      const wc = win.webContents;
      wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: "detach" });
    }
  });

  // 在文件管理器中显示文件
  ipcMain.handle("system:showInExplorer", (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  // 打开日志目录
  ipcMain.handle("system:openLogsDir", () => shell.openPath(logsDir));

  // 切换主进程语言
  ipcMain.on("system:setLocale", (_event, locale: LocaleCode) => {
    if (setLocale(locale)) {
      refreshTray();
      getThumbar()?.refreshLocale();
    }
  });

  // 显示并聚焦主窗口
  ipcMain.handle("system:focusMainWindow", () => focusMainWindow());

  // 在主窗口打开设置弹窗
  ipcMain.handle("system:openSettings", (_event, category?: string, highlight?: string) => {
    focusMainWindow();
    getMainWindow()?.webContents.send("system:openSettings", { category, highlight });
  });

  // 显示主窗口并展开到播放界面（任务栏歌词封面点击）
  // toggle 逻辑：播放界面展开时，最小化/隐藏/未聚焦仅恢复窗口，已聚焦才收起；
  // 已收起且有 prevState 且聚焦时恢复原状态；首次呼出记录状态并展开
  ipcMain.handle("system:openPlayingView", () => {
    const win = getMainWindow();
    if (!win) return;

    // 播放界面已展开：最小化/隐藏/未聚焦时恢复窗口，已聚焦时收起
    if (playingViewExpanded) {
      if (win.isMinimized() || !win.isVisible()) {
        focusMainWindow();
        return;
      }
      if (!win.isFocused()) {
        focusMainWindow();
        return;
      }
      win.webContents.send("system:collapsePlayingView");
      return;
    }

    // 有 prevState 且窗口聚焦 → 恢复原状态
    if (taskbarPrevState !== null && win.isFocused()) {
      win.minimize();
      taskbarPrevState = null;
      return;
    }

    // 首次呼出 → 记录原状态
    taskbarPrevState = win.isMinimized()
      ? "minimized"
      : win.isVisible() && !win.isFocused()
        ? "unfocused"
        : null;

    focusMainWindow();
    win.webContents.send("system:openPlayingView");
  });

  // 渲染端同步播放界面展开状态（isExpanded 变化时调用）
  // 同时在收起时清掉 taskbarPrevState，避免下次点击误触发恢复
  ipcMain.handle("system:setPlayingViewExpanded", (_event, expanded: boolean) => {
    playingViewExpanded = expanded;
    if (!expanded) taskbarPrevState = null;
  });

  // 渲染端手动收起播放界面时重置 toggle 状态（保留向后兼容，等价于 setPlayingViewExpanded(false)）
  ipcMain.handle("system:resetPlayingViewToggle", () => {
    playingViewExpanded = false;
    taskbarPrevState = null;
  });

  // 获取系统已安装字体
  let fontsCache: Promise<string[]> | null = null;
  ipcMain.handle("system:listFonts", (): Promise<string[]> => {
    if (!fontsCache) {
      fontsCache = getFonts({ disableQuoting: true }).catch((err) => {
        systemLog.error("[system] listFonts failed", err);
        fontsCache = null;
        return [];
      });
    }
    return fontsCache;
  });

  // 重启应用
  ipcMain.handle("system:relaunch", () => {
    app.relaunch();
    app.exit(0);
  });

  // 把封面图 URL 拉成字节回渲染层
  // 用于 canvas 取色等需要绕过跨域 tainted 的场景；限定 image/* 响应
  ipcMain.handle("system:fetchRemoteBytes", async (_event, url: string) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return { success: false, error: "无效的 URL" };
    }
    const buf = await fetchBytes(url, { requireImage: true });
    return { success: true, data: buf };
  });

  // 保存文件到下载目录
  ipcMain.handle("system:saveFile", async (_event, data: ArrayBuffer, fileName: string) => {
    try {
      // 只取末段并清洗非法字符
      const safeName = basename(fileName)
        .replace(/[\\/:*?"<>|]/g, " ")
        .trim();
      if (!safeName || safeName === "." || safeName === "..") {
        return { success: false, error: "invalid file name" };
      }
      const dir = app.getPath("downloads");
      const dot = safeName.lastIndexOf(".");
      const base = dot > 0 ? safeName.slice(0, dot) : safeName;
      const ext = dot > 0 ? safeName.slice(dot) : "";
      let target = join(dir, safeName);
      for (let seq = 2; existsSync(target); seq++) {
        target = join(dir, `${base} (${seq})${ext}`);
      }
      await writeFile(target, Buffer.from(data));
      return { success: true, path: target };
    } catch (error) {
      systemLog.error("[system] saveFile failed", error);
      return { success: false, error: String(error) };
    }
  });
};
