import { dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { getBackgroundsDir } from "@main/utils/config";
import { toCacheUrl } from "@main/utils/protocol";
import { systemLog } from "@main/utils/logger";

/** 允许的图片扩展名 */
const allowedExt = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);

/** 图片体积上限：30MB */
const MAX_BG_SIZE = 30 * 1024 * 1024;

/**
 * 注册主题相关的 IPC
 */
export const registerThemeIpc = (): void => {
  /**
   * 弹出文件选择框，选择背景图后复制到 app-cache/backgrounds/<sha1>.<ext>
   * 返回 cache:// URL；用户取消 / 体积超限 / 失败均返回 null
   */
  ipcMain.handle("theme:pickBackgroundImage", async (): Promise<string | null> => {
    try {
      const result = await dialog.showOpenDialog({
        title: "选择背景图片",
        properties: ["openFile"],
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "bmp", "gif"] }],
      });
      if (result.canceled) return null;
      const src = result.filePaths[0];
      if (!src) return null;
      const ext = path.extname(src).toLowerCase();
      if (!allowedExt.has(ext)) return null;
      // 体积校验
      const stat = await fs.stat(src);
      if (stat.size > MAX_BG_SIZE) {
        systemLog.warn(
          `[theme] background image too large: ${stat.size} bytes (max ${MAX_BG_SIZE})`,
        );
        return null;
      }
      const data = await fs.readFile(src);
      // 内容 hash 作为文件名
      const hash = createHash("sha1").update(data).digest("hex").slice(0, 16);
      // 清空整个目录再写入新图
      await fs.rm(getBackgroundsDir(), { recursive: true, force: true });
      await fs.mkdir(getBackgroundsDir(), { recursive: true });
      const dest = path.join(getBackgroundsDir(), `${hash}${ext}`);
      await fs.writeFile(dest, data);
      return toCacheUrl(dest) ?? null;
    } catch (err) {
      systemLog.error("[theme] pickBackgroundImage failed", err);
      return null;
    }
  });

  /**
   * 清空所有缓存的背景图
   */
  ipcMain.handle("theme:clearBackgroundImages", async (): Promise<void> => {
    try {
      await fs.rm(getBackgroundsDir(), { recursive: true, force: true });
    } catch (err) {
      systemLog.error("[theme] clearBackgroundImages failed", err);
    }
  });
};
