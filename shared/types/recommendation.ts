/** 外部推荐提供者 */
export type RecommendationProvider = "youtube-music";

/** 推荐导入方式 */
export type RecommendationImportMode = "playlist" | "append" | "replace";

/** 外部推荐曲目 */
export interface RecommendationInput {
  /** 外部提供者曲目 ID，仅用于关联导入结果 */
  sourceId: string;
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
}

/** Bridge 提交给 SPlayer 的推荐导入请求 */
export interface RecommendationImportRequest {
  provider: RecommendationProvider;
  mode: RecommendationImportMode;
  /** playlist 模式的歌单名称 */
  name?: string;
  items: RecommendationInput[];
}

/** 未能导入的推荐曲目 */
export interface RecommendationImportSkipped {
  sourceId: string;
  reason: "invalid" | "notFound";
}

/** 推荐导入结果 */
export interface RecommendationImportResult {
  requested: number;
  imported: number;
  skipped: RecommendationImportSkipped[];
  playlistId?: string;
}

/** 渲染进程收到的推荐导入任务 */
export interface RecommendationImportTask {
  requestId: string;
  request: RecommendationImportRequest;
}

/** 预加载层暴露给渲染进程的推荐导入 API */
export interface RecommendationsApi {
  ready: () => void;
  onImport: (callback: (task: RecommendationImportTask) => void) => () => void;
  complete: (requestId: string, result: RecommendationImportResult) => Promise<void>;
  fail: (requestId: string, error: string) => Promise<void>;
}
