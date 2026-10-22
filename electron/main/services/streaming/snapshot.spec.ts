// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import { getTracks, upsertTracks } from "@main/database/streaming/tracks";
import { getAlbums } from "@main/database/streaming/albums";
import {
  clearStreamingStage,
  publishStreamingStage,
  recordStreamingStageFavorite,
  resetStreamingStage,
  stageStreamingPage,
} from "./snapshot";
import { cancelStreamingSync, queueStreamingSync } from "./sync";

const state = vi.hoisted(() => ({
  db: null as unknown,
  connection: null as DatabaseSync | null,
  depth: 0,
  adapter: {} as Record<string, ReturnType<typeof vi.fn>>,
  notify: vi.fn(),
}));
vi.mock("@main/database", () => ({ getDb: () => state.db, isDbOpen: () => Boolean(state.db) }));
vi.mock("./connection", () => ({
  withStreamingAdapter: async (
    _serverId: string,
    request: (config: unknown, adapter: unknown) => unknown,
    signal: AbortSignal,
  ) => request({ id: "server", signal }, state.adapter),
}));
vi.mock("@main/utils/logger", () => ({ streamingLog: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("@main/utils/broadcast", () => ({ sendToMain: state.notify }));

/**
 * 创建同步测试歌曲
 * @param id - 服务端 ID
 * @returns 轻量歌曲数据
 */
const track = (id: string): Track => ({
  id: `server:${id}`,
  originalId: id,
  serverId: "server",
  source: "streaming",
  title: id,
  artists: [],
  duration: 2000,
  favorite: false,
});

beforeEach(() => {
  state.connection = new DatabaseSync(":memory:");
  state.depth = 0;
  state.db = {
    prepare: state.connection.prepare.bind(state.connection),
    exec: state.connection.exec.bind(state.connection),
    /**
     * 使用真实 SQLite 事务模拟嵌套写入
     * @param action - 事务操作
     * @returns 事务入口
     */
    transaction: (action: () => unknown) => () => {
      const outer = state.depth++ === 0;
      if (outer) state.connection!.exec("BEGIN");
      try {
        const result = action();
        if (outer) state.connection!.exec("COMMIT");
        return result;
      } catch (error) {
        if (outer) state.connection!.exec("ROLLBACK");
        throw error;
      } finally {
        state.depth--;
      }
    },
  };
  state.connection.exec(`CREATE TABLE remote_tracks (
    server_id TEXT NOT NULL, remote_id TEXT NOT NULL, data TEXT NOT NULL,
    title TEXT NOT NULL, search_text TEXT NOT NULL, generation INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (server_id, remote_id));`);
  for (const table of ["remote_albums", "remote_artists", "remote_playlists"])
    state.connection.exec(`CREATE TABLE ${table} (
    server_id TEXT NOT NULL, remote_id TEXT NOT NULL, data TEXT NOT NULL, name TEXT NOT NULL,
    generation INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (server_id, remote_id))`);
  state.notify.mockClear();
  cancelStreamingSync("server");
  state.adapter = {
    listSongs: vi.fn(
      async ({ signal }: { signal: AbortSignal }, { offset = 0 }: { offset: number }) => {
        signal.throwIfAborted();
        return Array.from({ length: 650 }, (_, id) => track(String(id))).slice(offset, offset + 50);
      },
    ),
    listAlbums: vi.fn(async (_config: unknown, { offset = 0 }: { offset: number }) =>
      Array.from({ length: 650 }, (_, id) => ({ id: String(id), name: `专辑 ${id}` })).slice(
        offset,
        offset + 50,
      ),
    ),
    listArtists: vi.fn(async () => []),
    listPlaylists: vi.fn(async () => []),
  };
});
afterEach(() => {
  cancelStreamingSync("server");
  state.connection?.close();
  state.db = null;
});

describe("流媒体原子快照", () => {
  it("暂存不改变可见媒体库，发布才删除旧条目", () => {
    upsertTracks([{ serverId: "server", remoteId: "old", track: track("old"), generation: 1 }]);
    resetStreamingStage("server");
    stageStreamingPage("server", "songs", [track("new")]);
    expect(getTracks("server").map((item) => item.originalId)).toEqual(["old"]);
    publishStreamingStage("server");
    expect(getTracks("server").map((item) => item.originalId)).toEqual(["new"]);
    clearStreamingStage("server");
  });

  it("后续索引写入失败时整次发布回滚", () => {
    upsertTracks([{ serverId: "server", remoteId: "old", track: track("old"), generation: 1 }]);
    resetStreamingStage("server");
    stageStreamingPage("server", "songs", [track("new")]);
    stageStreamingPage("server", "albums", [{ id: "bad", name: "bad" }]);
    state.connection!.exec(
      "CREATE TRIGGER reject_album BEFORE INSERT ON remote_albums BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
    );
    expect(() => publishStreamingStage("server")).toThrow("injected failure");
    expect(getTracks("server").map((item) => item.originalId)).toEqual(["old"]);
  });

  it("同步期间的收藏修改不会被迟到分页覆盖，任务结束释放覆盖记录", () => {
    resetStreamingStage("server");
    recordStreamingStageFavorite("server", "new", true);
    stageStreamingPage("server", "songs", [track("new")]);
    publishStreamingStage("server");
    expect(getTracks("server")[0].favorite).toBe(true);
    clearStreamingStage("server");
    recordStreamingStageFavorite("server", "new", false);
    expect(
      state.connection!.prepare("SELECT COUNT(*) AS count FROM streaming_stage_favorites").get()
        ?.count,
    ).toBe(0);
  });

  it("同步服务端限制为 50 条的 650 首歌曲和 650 张专辑", async () => {
    expect(
      queueStreamingSync(
        {
          id: "server",
          name: "测试",
          type: "navidrome",
          url: "https://server",
          username: "user",
          password: "",
          hasPassword: false,
        },
        true,
      ),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(state.notify).toHaveBeenCalledWith("streaming:syncState", {
        serverId: "server",
        state: "completed",
      }),
    );
    expect(getTracks("server")).toHaveLength(650);
    expect(getAlbums("server")).toHaveLength(650);
    expect(
      state.connection!.prepare("SELECT COUNT(*) AS count FROM streaming_stage").get()?.count,
    ).toBe(0);
  });

  it("歌曲读取成功但专辑请求失败时保留旧快照并通知失败", async () => {
    upsertTracks([{ serverId: "server", remoteId: "old", track: track("old"), generation: 1 }]);
    state.adapter.listAlbums.mockRejectedValueOnce(new Error("网络中断"));
    queueStreamingSync(
      {
        id: "server",
        name: "测试",
        type: "navidrome",
        url: "https://server",
        username: "user",
        password: "",
        hasPassword: false,
      },
      true,
    );
    await vi.waitFor(() =>
      expect(state.notify).toHaveBeenCalledWith("streaming:syncState", {
        serverId: "server",
        state: "failed",
        error: "网络中断",
      }),
    );
    expect(getTracks("server").map((item) => item.originalId)).toEqual(["old"]);
    expect(state.notify).not.toHaveBeenCalledWith("streaming:libraryUpdated", "server");
  });

  it("取消时中断在途请求并且不发布快照", async () => {
    state.adapter.listSongs.mockImplementationOnce(
      async ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    queueStreamingSync(
      {
        id: "server",
        name: "测试",
        type: "navidrome",
        url: "https://server",
        username: "user",
        password: "",
        hasPassword: false,
      },
      true,
    );
    await vi.waitFor(() => expect(state.adapter.listSongs).toHaveBeenCalled());
    cancelStreamingSync("server");
    await vi.waitFor(() =>
      expect(state.notify).toHaveBeenCalledWith("streaming:syncState", {
        serverId: "server",
        state: "cancelled",
      }),
    );
    expect(state.notify).not.toHaveBeenCalledWith("streaming:libraryUpdated", "server");
  });
});
