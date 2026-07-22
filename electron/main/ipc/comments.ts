import { ipcMain } from "electron";
import { getCommentSources, getMusicComments } from "@main/services/comments";
import { getCreatorComments } from "@main/services/comments/creator";
import { coreLog } from "@main/utils/logger";
import type {
  MusicCommentCreatorQuery,
  MusicCommentCreatorResponse,
  MusicCommentQuery,
  MusicCommentResponse,
} from "@shared/types/comment";

/** 注册评论 IPC */
export const registerCommentsIpc = (): void => {
  ipcMain.handle("comments:sources", () => getCommentSources());

  ipcMain.handle(
    "comments:get",
    async (_evt, args: MusicCommentQuery): Promise<MusicCommentResponse> => {
      try {
        return { ok: true, data: await getMusicComments(args) };
      } catch (err) {
        coreLog.warn("[comments] get failed:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    "comments:creator",
    async (
      _evt,
      args: MusicCommentCreatorQuery,
    ): Promise<MusicCommentCreatorResponse> => {
      try {
        return { ok: true, data: await getCreatorComments(args) };
      } catch (err) {
        coreLog.warn("[comments] creator failed:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
};
