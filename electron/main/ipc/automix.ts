import { rmSync } from "node:fs";
import { app, ipcMain } from "electron";
import { automixCacheDir } from "@main/utils/paths";
import {
  cancelAutoMixDownload,
  getAutoMixComponentStatus,
  installAutoMixComponents,
} from "@main/services/automix/components";
import type { AutoMixComponentId } from "@shared/types/automix";

/** 注册只在用户操作时下载的 AutoMix 组件管理接口 */
export const registerAutoMixIpc = (): void => {
  ipcMain.handle("automix:getStatus", () => getAutoMixComponentStatus());
  ipcMain.handle("automix:download", (_event, id: AutoMixComponentId) =>
    installAutoMixComponents(id),
  );
  ipcMain.handle("automix:cancelDownload", () => cancelAutoMixDownload());
  app.on("before-quit", () => {
    cancelAutoMixDownload();
    // 分轨窗口每对数十 MB，不留到下次会话；引擎仍占用文件或崩溃残留时由下次首次分离清空
    try {
      rmSync(automixCacheDir, { recursive: true, force: true });
    } catch {}
  });
};
