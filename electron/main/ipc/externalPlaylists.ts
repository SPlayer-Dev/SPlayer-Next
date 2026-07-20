import { ipcMain } from "electron";
import type {
  ExternalPlaylistOperation,
  ExternalPlaylistResult,
} from "@shared/types/externalPlaylist";
import { sendToMain } from "@main/utils/broadcast";

const REQUEST_TIMEOUT = 60_000;

interface PendingRequest {
  resolve: (result: ExternalPlaylistResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRequest>();
let rendererReady = false;

/** 请求渲染进程执行 IndexedDB 中的歌单操作 */
export const requestExternalPlaylist = (
  task: ExternalPlaylistOperation,
): Promise<ExternalPlaylistResult> => {
  if (!rendererReady) return Promise.reject(new Error("renderer unavailable"));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("external playlist request timed out"));
    }, REQUEST_TIMEOUT);
    pending.set(requestId, { resolve, reject, timer });
    sendToMain("externalPlaylists:request", { requestId, ...task });
  });
};

/** 注册外部歌单操作 IPC */
export const registerExternalPlaylistsIpc = (): void => {
  ipcMain.on("externalPlaylists:ready", () => {
    rendererReady = true;
  });

  ipcMain.handle(
    "externalPlaylists:complete",
    (_event, requestId: string, result: ExternalPlaylistResult) => {
      const entry = pending.get(requestId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(requestId);
      entry.resolve(result);
    },
  );

  ipcMain.handle("externalPlaylists:fail", (_event, requestId: string, message: string) => {
    const entry = pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.reject(new Error(message));
  });
};
