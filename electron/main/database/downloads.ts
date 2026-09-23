import type { DownloadTask } from "@shared/types/download";
import type { Track } from "@shared/types/player";
import { getDb } from "./index";

/** sqlite 原始行 */
interface RawRow {
  task_id: string;
  track_json: string;
  quality_level: string;
  status: string;
  received: number;
  total: number;
  file_path: string | null;
  error_code: string | null;
  tag_warning: number;
  created_at: number;
  finished_at: number | null;
}

/** sqlite 行 → 业务 DownloadTask */
const toTask = (raw: RawRow): DownloadTask => ({
  taskId: raw.task_id,
  track: JSON.parse(raw.track_json) as Track,
  qualityLevel: raw.quality_level as DownloadTask["qualityLevel"],
  status: raw.status as DownloadTask["status"],
  received: raw.received,
  total: raw.total,
  filePath: raw.file_path ?? undefined,
  errorCode: raw.error_code ?? undefined,
  tagWarning: raw.tag_warning === 1,
  createdAt: raw.created_at,
  finishedAt: raw.finished_at ?? undefined,
});

/** 写入或覆盖一条任务 */
export const upsert = (task: DownloadTask): void => {
  getDb()
    .prepare(
      `INSERT INTO download_tasks
         (task_id, track_json, quality_level, status, received, total, file_path, error_code, tag_warning, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET
         track_json = excluded.track_json,
         quality_level = excluded.quality_level,
         status = excluded.status,
         received = excluded.received,
         total = excluded.total,
         file_path = excluded.file_path,
         error_code = excluded.error_code,
         tag_warning = excluded.tag_warning,
         finished_at = excluded.finished_at`,
    )
    .run(
      task.taskId,
      JSON.stringify(task.track),
      task.qualityLevel,
      task.status,
      task.received,
      task.total,
      task.filePath ?? null,
      task.errorCode ?? null,
      task.tagWarning ? 1 : 0,
      task.createdAt,
      task.finishedAt ?? null,
    );
};

/** 按 id 查 */
export const findById = (taskId: string): DownloadTask | null => {
  const raw = getDb().prepare("SELECT * FROM download_tasks WHERE task_id = ?").get(taskId) as
    RawRow | undefined;
  return raw ? toTask(raw) : null;
};

/** 列出全部任务，最新在前 */
export const listAll = (): DownloadTask[] => {
  const rows = getDb()
    .prepare("SELECT * FROM download_tasks ORDER BY created_at DESC")
    .all() as RawRow[];
  return rows.map(toTask);
};

/** 列出指定音质的已完成任务（用于重复下载去重） */
export const listCompletedByQuality = (quality: string): DownloadTask[] => {
  const rows = getDb()
    .prepare("SELECT * FROM download_tasks WHERE status = 'done' AND quality_level = ?")
    .all(quality) as RawRow[];
  return rows.map(toTask);
};

/** 删除一条 */
export const remove = (taskId: string): void => {
  getDb().prepare("DELETE FROM download_tasks WHERE task_id = ?").run(taskId);
};

/** 删除全部已结束（非进行中）任务 */
export const clearFinished = (): void => {
  getDb().prepare("DELETE FROM download_tasks WHERE status NOT IN ('queued','downloading')").run();
};

/** 启动时把残留的进行中任务重置为中断 */
export const markInterrupted = (): void => {
  getDb()
    .prepare(
      "UPDATE download_tasks SET status = 'interrupted' WHERE status IN ('queued','downloading')",
    )
    .run();
};
