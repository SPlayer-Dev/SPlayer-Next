import type { PlaybackContext, PlaybackQueueItem, Track } from "@shared/types/player";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(() => Promise.resolve()),
}));

vi.mock("localforage", () => ({
  default: {
    createInstance: () => storage,
  },
}));

import {
  findTrackIndex,
  getTrack,
  insertManyToQueue,
  insertToQueue,
  moveInQueue,
  originalQueue,
  queue,
  queueEntries,
  removeFromQueue,
  restoreQueue,
  setQueue,
  shuffleQueue,
  unshuffleQueue,
  updateQueueItem,
  updateQueueTracks,
} from "./queue";

const track = (id: string): Track => ({
  id,
  source: "local",
  title: id,
  artists: [],
  duration: 1_000,
});

const context: PlaybackContext = {
  provider: "netease",
  originId: "456",
  originType: "playlist",
  originName: "测试歌单",
};

const entry = (id: string, playbackContext?: PlaybackContext): PlaybackQueueItem => ({
  track: track(id),
  context: playbackContext,
});

describe("queue", () => {
  beforeEach(() => {
    queueEntries.value = [];
    originalQueue.value = null;
    storage.getItem.mockReset();
    storage.setItem.mockClear();
  });

  it("替换队列时复制输入并清除洗牌备份", () => {
    const input = [track("a"), track("b")];
    originalQueue.value = [entry("old")];

    setQueue(input);
    input.push(track("c"));

    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(originalQueue.value).toBeNull();
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  it("插入位置会限制在队列边界并同步洗牌备份", () => {
    queueEntries.value = [entry("a"), entry("c")];
    originalQueue.value = [entry("a"), entry("c")];

    insertToQueue(track("b"), 1);
    insertManyToQueue([track("d"), track("e")], 99);

    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(originalQueue.value?.map((item) => item.track.id)).toEqual(["a", "c", "b", "d", "e"]);
  });

  it("删除歌曲时按 ID 同步洗牌备份", () => {
    queueEntries.value = [entry("c"), entry("a"), entry("b")];
    originalQueue.value = [entry("a"), entry("b"), entry("c")];

    removeFromQueue(0);

    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(originalQueue.value?.map((item) => item.track.id)).toEqual(["a", "b"]);
  });

  it("移动和更新曲目时保持队列身份操作正确", () => {
    queueEntries.value = [entry("a"), entry("b"), entry("c")];

    moveInQueue(0, 2);
    updateQueueTracks([{ ...track("b"), title: "updated" }]);

    expect(queue.value.map(({ id }) => id)).toEqual(["b", "c", "a"]);
    expect(getTrack(0)?.title).toBe("updated");
    expect(getTrack(99)).toBeNull();
    expect(findTrackIndex("a")).toBe(2);
  });

  it("取消随机播放时恢复原顺序并返回当前歌曲索引", () => {
    queueEntries.value = [entry("a"), entry("b"), entry("c")];
    vi.spyOn(Math, "random").mockReturnValue(0);

    shuffleQueue(1);

    expect(queue.value[0].id).toBe("b");
    expect(originalQueue.value?.map((item) => item.track.id)).toEqual(["a", "b", "c"]);
    expect(unshuffleQueue("b")).toBe(1);
    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(originalQueue.value).toBeNull();
  });

  it("播放上下文跟随队列项插入、移动和随机播放", () => {
    setQueue([track("a"), track("b")], context);
    insertToQueue(track("c"), 1, { ...context, originId: "789", originType: "album" });
    moveInQueue(1, 2);
    vi.spyOn(Math, "random").mockReturnValue(0);
    shuffleQueue(0);

    expect(queueEntries.value.find((item) => item.track.id === "a")?.context).toEqual(context);
    expect(queueEntries.value.find((item) => item.track.id === "b")?.context).toEqual(context);
    expect(queueEntries.value.find((item) => item.track.id === "c")?.context).toEqual({
      ...context,
      originId: "789",
      originType: "album",
    });
  });

  it("队列中已有曲目时可替换播放上下文", () => {
    setQueue([track("a")], context);
    const nextContext: PlaybackContext = {
      provider: "qqmusic",
      originId: "789",
      originType: "album",
    };

    updateQueueItem(0, { ...track("a"), title: "updated" }, nextContext);

    expect(queueEntries.value[0]).toEqual({
      track: { ...track("a"), title: "updated" },
      context: nextContext,
    });
  });

  it("从持久化存储恢复队列和随机播放备份", async () => {
    storage.getItem
      .mockResolvedValueOnce([track("a"), track("b")])
      .mockResolvedValueOnce([track("b"), track("a")]);

    await restoreQueue();

    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(originalQueue.value?.map((item) => item.track.id)).toEqual(["b", "a"]);
  });

  it("恢复时将旧 Track 队列包装为队列项", async () => {
    storage.getItem
      .mockResolvedValueOnce([{ ...track("a"), source: "netease" }])
      .mockResolvedValueOnce(null);

    await restoreQueue();

    expect(queueEntries.value[0]).toEqual({
      track: { ...track("a"), source: "netease" },
    });
  });

  it("恢复时保留队列项的播放来源名称", async () => {
    storage.getItem.mockResolvedValueOnce([entry("a", context)]).mockResolvedValueOnce(null);

    await restoreQueue();

    expect(queueEntries.value[0]?.context).toEqual(context);
  });
});
