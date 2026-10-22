// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadTask } from "@shared/types/download";

const state = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock("./index", () => ({ getDb: () => state.db }));
import { listCompletedPaths, upsert } from "./downloads";

describe("下载记录精确查询", () => {
  beforeEach(() => {
    state.db = new DatabaseSync(":memory:");
    state.db.exec(`CREATE TABLE download_tasks (
      task_id TEXT PRIMARY KEY, track_json TEXT NOT NULL, quality_level TEXT NOT NULL,
      status TEXT NOT NULL, received INTEGER, total INTEGER, file_path TEXT,
      error_code TEXT, tag_warning INTEGER, created_at INTEGER, finished_at INTEGER
    )`);
  });
  afterEach(() => state.db?.close());

  it("仅返回同平台同 ID 的已完成记录，不限制音质，最新文件优先", () => {
    const task: DownloadTask = {
      taskId: "older",
      status: "done",
      qualityLevel: "hq",
      received: 1,
      total: 1,
      createdAt: 1,
      finishedAt: 1,
      filePath: "older.flac",
      track: { source: "netease", id: "1", title: "test", artists: [], duration: 1000 },
    };
    upsert(task);
    upsert({
      ...task,
      taskId: "newer",
      qualityLevel: "lossless",
      finishedAt: 2,
      filePath: "newer.flac",
    });
    upsert({ ...task, taskId: "other-platform", track: { ...task.track, source: "qqmusic" } });
    upsert({ ...task, taskId: "other-song", track: { ...task.track, id: "2" } });
    upsert({ ...task, taskId: "pending", status: "downloading" });
    upsert({ ...task, taskId: "failed", status: "failed" });
    upsert({ ...task, taskId: "no-path", filePath: undefined });
    expect(listCompletedPaths(task.track)).toEqual(["newer.flac", "older.flac"]);
  });

  it("流媒体的同名 ID 不会跨服务器命中", () => {
    const task: DownloadTask = {
      taskId: "server-a",
      status: "done",
      qualityLevel: "hq",
      received: 1,
      total: 1,
      createdAt: 1,
      filePath: "a.flac",
      track: {
        source: "streaming",
        id: "1",
        serverId: "a",
        originalId: "remote",
        title: "test",
        artists: [],
        duration: 1000,
      },
    };
    upsert(task);
    upsert({
      ...task,
      taskId: "server-b",
      filePath: "b.flac",
      track: { ...task.track, serverId: "b" },
    });
    expect(listCompletedPaths(task.track)).toEqual(["a.flac"]);
    expect(listCompletedPaths({ ...task.track, originalId: "other" })).toEqual([]);
    expect(listCompletedPaths({ ...task.track, serverRevision: 1 })).toEqual([]);
  });
});
