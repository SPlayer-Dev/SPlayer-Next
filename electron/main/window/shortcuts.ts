import type { BrowserWindow } from "electron";
import { isDev } from "@main/utils/config";

/**
 * 拦截默认菜单的开发者工具与缩放快捷键，开发环境用 F12 开关开发者工具；Ctrl/Cmd+R 留给应用内快捷键
 * @param window - 新创建的窗口
 */
export const watchWindowShortcuts = (window: BrowserWindow): void => {
  const { webContents } = window;
  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const modifier = input.control || input.meta;
    if (isDev) {
      if (input.code === "F12") {
        if (webContents.isDevToolsOpened()) webContents.closeDevTools();
        else webContents.openDevTools({ mode: "undocked" });
      }
    } else if (
      input.code === "KeyI" &&
      ((input.alt && input.meta) || (input.control && input.shift))
    ) {
      event.preventDefault();
    }
    // 界面缩放由设置项统一控制
    if (modifier && (input.code === "Minus" || (input.code === "Equal" && input.shift))) {
      event.preventDefault();
    }
  });
};
