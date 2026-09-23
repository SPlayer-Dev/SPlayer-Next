/**
 * 下载 IPC
 *
 * 渲染层构建好请求经 download:start 交给 downloadManager 整批排队；
 * 轮到某任务下载时主进程经 download:resolve 索取，渲染层解析后经 download:resolution 回传；
 * 进度/状态由服务通过 broadcast 推送。
 */

import { ipcMain, dialog } from "electron";
import { store } from "@main/store";
import { getDownloadDir } from "@main/utils/config";
import * as downloadManager from "@main/services/downloadManager";
import type { DownloadRequest, DownloadResolution } from "@shared/types/download";

export const registerDownloadIpc = (): void => {
  ipcMain.handle("download:start", (_evt, req: DownloadRequest) => downloadManager.enqueue(req));
  ipcMain.handle("download:startMany", (_evt, reqs: DownloadRequest[]) =>
    downloadManager.enqueueMany(reqs),
  );
  ipcMain.handle("download:retry", (_evt, req: DownloadRequest) => downloadManager.enqueue(req));
  ipcMain.handle("download:resolution", (_evt, taskId: string, res: DownloadResolution) =>
    downloadManager.submitResolution(taskId, res),
  );
  ipcMain.handle("download:resolveFailed", (_evt, taskId: string) =>
    downloadManager.failResolution(taskId),
  );
  ipcMain.handle("download:cancel", (_evt, taskId: string) => downloadManager.cancel(taskId));
  ipcMain.handle("download:remove", (_evt, taskId: string) => downloadManager.remove(taskId));
  ipcMain.handle("download:clearFinished", () => downloadManager.clearFinished());
  ipcMain.handle("download:list", () => downloadManager.list());

  ipcMain.handle("download:getDir", () => getDownloadDir());
  ipcMain.handle("download:resetDir", () => {
    store.set("download.dir", null);
    return getDownloadDir();
  });
  ipcMain.handle("download:pickDir", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择下载目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, dir: getDownloadDir(), reason: "canceled" as const };
    }
    const dir = result.filePaths[0];
    store.set("download.dir", dir);
    return { ok: true, dir };
  });
};
