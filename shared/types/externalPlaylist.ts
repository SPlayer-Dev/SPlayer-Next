import type { RecommendationImportSkipped, RecommendationInput } from "./recommendation";

/** 外部 API 可见的歌单元数据 */
export interface ExternalPlaylist {
  id: string;
  title: string;
  description?: string;
  trackCount: number;
  cover?: string;
  createTime?: number;
  updateTime?: number;
}

/** 外部歌单操作 */
export type ExternalPlaylistOperation =
  | { operation: "list" }
  | { operation: "get"; playlistId: string }
  | { operation: "create"; title: string; description?: string; cover?: string }
  | {
      operation: "update";
      playlistId: string;
      title?: string;
      description?: string | null;
      cover?: string | null;
    }
  | { operation: "remove"; playlistId: string }
  | {
      operation: "replaceTracks";
      playlistId: string;
      items: RecommendationInput[];
    };

/** 外部歌单操作任务 */
export type ExternalPlaylistTask = ExternalPlaylistOperation & { requestId: string };

/** 外部歌单操作结果 */
export interface ExternalPlaylistResult {
  found?: boolean;
  playlist?: ExternalPlaylist;
  playlists?: ExternalPlaylist[];
  requested?: number;
  imported?: number;
  skipped?: RecommendationImportSkipped[];
}

/** 预加载层暴露给渲染进程的外部歌单操作 API */
export interface ExternalPlaylistsApi {
  ready: () => void;
  onRequest: (callback: (task: ExternalPlaylistTask) => void) => () => void;
  complete: (requestId: string, result: ExternalPlaylistResult) => Promise<void>;
  fail: (requestId: string, error: string) => Promise<void>;
}
