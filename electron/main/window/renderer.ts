import type { BrowserWindow } from "electron";
import { join } from "path";

/**
 * 加载渲染进程页面，开发环境走 Vite dev server
 * @param win - 目标窗口
 * @param page - 相对渲染进程根目录的 HTML 路径
 * @param hash - 路由 hash
 * @returns 页面加载完成的 Promise
 */
export const loadRendererPage = (
  win: BrowserWindow,
  page: string,
  hash?: string,
): Promise<void> => {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const suffix = hash === undefined ? "" : `#${hash}`;
    return win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}/${page}${suffix}`);
  }
  return win.loadFile(join(import.meta.dirname, "../renderer", MAIN_WINDOW_VITE_NAME, page), {
    hash,
  });
};
