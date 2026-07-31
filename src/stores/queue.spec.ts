import type { Track } from "@shared/types/player";
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
  removeFromQueue,
  restoreQueue,
  setQueue,
  shuffleQueue,
  unshuffleQueue,
  updateQueueTracks,
} from "./queue";

const track = (id: string): Track => ({
  id,
  source: "local",
  title: id,
  artists: [],
  duration: 1_000,
});

describe("queue", () => {
  beforeEach(() => {
    queue.value = [];
    originalQueue.value = null;
    storage.getItem.mockReset();
    storage.setItem.mockClear();
  });

  it("替换队列时复制输入并清除洗牌备份", () => {
    const input = [track("a"), track("b")];
    originalQueue.value = [track("old")];

    setQueue(input);
    input.push(track("c"));

    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(originalQueue.value).toBeNull();
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  it("插入位置会限制在队列边界并同步洗牌备份", () => {
    queue.value = [track("a"), track("c")];
    originalQueue.value = [track("a"), track("c")];

    insertToQueue(track("b"), 1);
    insertManyToQueue([track("d"), track("e")], 99);

    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(originalQueue.value?.map(({ id }) => id)).toEqual(["a", "c", "b", "d", "e"]);
  });

  it("删除歌曲时按 ID 同步洗牌备份", () => {
    queue.value = [track("c"), track("a"), track("b")];
    originalQueue.value = [track("a"), track("b"), track("c")];

    removeFromQueue(0);

    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(originalQueue.value?.map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("移动和更新曲目时保持队列身份操作正确", () => {
    queue.value = [track("a"), track("b"), track("c")];

    moveInQueue(0, 2);
    updateQueueTracks([{ ...track("b"), title: "updated" }]);

    expect(queue.value.map(({ id }) => id)).toEqual(["b", "c", "a"]);
    expect(getTrack(0)?.title).toBe("updated");
    expect(getTrack(99)).toBeNull();
    expect(findTrackIndex("a")).toBe(2);
  });

  it("取消随机播放时恢复原顺序并返回当前歌曲索引", () => {
    queue.value = [track("a"), track("b"), track("c")];
    vi.spyOn(Math, "random").mockReturnValue(0);

    shuffleQueue(1);

    expect(queue.value[0].id).toBe("b");
    expect(originalQueue.value?.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(unshuffleQueue("b")).toBe(1);
    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(originalQueue.value).toBeNull();
  });

  it("从持久化存储恢复队列和随机播放备份", async () => {
    storage.getItem
      .mockResolvedValueOnce([track("a"), track("b")])
      .mockResolvedValueOnce([track("b"), track("a")]);

    await restoreQueue();

    expect(queue.value.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(originalQueue.value?.map(({ id }) => id)).toEqual(["b", "a"]);
  });
});
