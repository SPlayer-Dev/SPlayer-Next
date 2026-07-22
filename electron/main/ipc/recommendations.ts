import { ipcMain } from "electron";
import type {
  RecommendationImportRequest,
  RecommendationImportResult,
} from "@shared/types/recommendation";
import { sendToMain } from "@main/utils/broadcast";

const IMPORT_TIMEOUT = 60_000;

interface PendingImport {
  resolve: (result: RecommendationImportResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingImport>();
let rendererReady = false;

/** 请求渲染进程解析并导入外部推荐 */
export const importRecommendations = (
  request: RecommendationImportRequest,
): Promise<RecommendationImportResult> => {
  if (!rendererReady) return Promise.reject(new Error("renderer unavailable"));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("renderer import timed out"));
    }, IMPORT_TIMEOUT);
    pending.set(requestId, { resolve, reject, timer });
    sendToMain("recommendations:import", { requestId, request });
  });
};

/** 注册推荐导入结果回传 IPC */
export const registerRecommendationsIpc = (): void => {
  ipcMain.on("recommendations:ready", () => {
    rendererReady = true;
  });

  ipcMain.handle(
    "recommendations:complete",
    (_event, requestId: string, result: RecommendationImportResult) => {
      const entry = pending.get(requestId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(requestId);
      entry.resolve(result);
    },
  );

  ipcMain.handle("recommendations:fail", (_event, requestId: string, message: string) => {
    const entry = pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.reject(new Error(message));
  });
};
