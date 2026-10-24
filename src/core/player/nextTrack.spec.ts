import type { Track } from "@shared/types/player";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const heart = vi.hoisted(() => ({
  extendQueue: vi.fn(),
}));

const storage = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    getItem: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    setItem: vi.fn((key: string, value: unknown) => {
      values.set(key, value);
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
      return Promise.resolve();
    }),
  };
});

const playerApi = vi.hoisted(() => ({
  load: vi.fn(),
  stop: vi.fn(() => Promise.resolve()),
  syncPlayMode: vi.fn(),
}));

vi.mock("localforage", () => ({
  default: {
    createInstance: () => storage,
  },
}));

vi.mock("@/utils/color", () => ({ extractColorFromUrl: vi.fn() }));

vi.mock("@/services/audioSource", () => ({
  resolveTrackSource: vi.fn(async () => ({
    source: "C:/fake.mp3",
    fromCache: false,
    provider: "local",
  })),
}));

vi.mock("@/services/lyric/loader", () => ({
  beginLoad: vi.fn(),
  loadForTrack: vi.fn(),
  watchLyricPreference: vi.fn(),
}));

vi.mock("@/services/coverLoader", () => ({
  loadCoverForTrack: vi.fn(),
}));

vi.mock("@/services/abLoop", () => ({
  reset: vi.fn(),
}));

vi.mock("@/services/cacheScheduler", () => ({
  cancel: vi.fn(),
  schedule: vi.fn(),
}));

vi.mock("@/services/nextTrackPreloader", () => ({
  consumePreloadedTrack: vi.fn(() => null),
  disposeNextTrackPreload: vi.fn(),
  installNextTrackPreloadWatchers: vi.fn(),
  scheduleNextTrackPreload: vi.fn(),
}));

vi.mock("@/composables/useFavorite", () => ({
  useFavorite: () => ({}),
}));

vi.mock("@/composables/useToast", () => ({
  toast: { info: vi.fn(), warning: vi.fn(), success: vi.fn(), loading: vi.fn() },
}));

vi.mock("@/i18n", () => ({
  default: { global: { t: (key: string) => key } },
}));

vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    preset: { fuckDjMode: false, uncensorProfanity: false },
    lyric: { cjkTransform: false },
  }),
}));

vi.mock("./heartMode", () => ({
  extendQueue: heart.extendQueue,
}));

import { useMediaStore } from "@/stores/media";
import * as queueStore from "@/stores/queue";
import { useStatusStore } from "@/stores/status";
import { exitHeartMode, nextTrack, playHeartMode } from "./index";

const track = (id: string): Track => ({
  id,
  source: "netease",
  title: id,
  artists: [],
  duration: 1_000,
});

describe("nextTrack", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    queueStore.queueEntries.value = [];
    storage.values.clear();
    heart.extendQueue.mockReset();
    playerApi.load.mockReset();
    playerApi.syncPlayMode.mockReset();
    playerApi.load.mockResolvedValue({
      success: true,
      data: { detail: {}, mediaInfo: { duration: 1_000 } },
    });
    (window as unknown as { api: unknown }).api = { player: playerApi };
  });

  it("心动模式队列末尾按当前歌曲续推并播放新批次第一首", async () => {
    const status = useStatusStore();
    const media = useMediaStore();
    queueStore.setQueue([track("a"), track("b")]);
    queueStore.markPlayedOnce(0);
    status.heartMode = true;
    status.playIndex = 1;
    heart.extendQueue.mockImplementation(async () => {
      queueStore.insertManyToQueue([track("c")], queueStore.queueLength.value);
      return 1;
    });

    await nextTrack();

    expect(heart.extendQueue).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
    expect(queueStore.queue.value.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(status.playIndex).toBe(2);
    expect(media.track?.id).toBe("c");
  });

  it("续推没有新曲目时回退到原有的队列循环", async () => {
    const status = useStatusStore();
    queueStore.setQueue([track("a"), track("b")]);
    queueStore.markPlayedOnce(0);
    status.heartMode = true;
    status.playIndex = 1;
    heart.extendQueue.mockResolvedValue(0);

    await nextTrack();

    expect(status.playIndex).toBe(0);
  });

  it("续推期间队列被替换时不再回绕播放", async () => {
    const status = useStatusStore();
    const media = useMediaStore();
    queueStore.setQueue([track("a"), track("b")]);
    queueStore.markPlayedOnce(0);
    status.heartMode = true;
    status.playIndex = 1;
    heart.extendQueue.mockImplementation(async () => {
      queueStore.setQueue([track("x")]);
      return 0;
    });

    await nextTrack();

    expect(status.playIndex).toBe(1);
    expect(media.track).toBeNull();
  });

  it("整轮听完但不在队尾时后台续推", async () => {
    const status = useStatusStore();
    queueStore.setQueue([track("a"), track("b"), track("c")]);
    queueStore.markPlayedOnce(0);
    queueStore.markPlayedOnce(1);
    queueStore.markPlayedOnce(2);
    status.heartMode = true;
    status.playIndex = 1;
    heart.extendQueue.mockResolvedValue(1);

    await nextTrack();

    expect(heart.extendQueue).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
    expect(status.playIndex).toBe(2);
  });

  it("关闭自动推荐后不在队尾续推，直接回绕队列", async () => {
    const status = useStatusStore();
    queueStore.setQueue([track("a"), track("b")]);
    queueStore.markPlayedOnce(0);
    queueStore.markPlayedOnce(1);
    status.heartMode = true;
    status.heartModeWantMore = false;
    status.playIndex = 1;

    await nextTrack();

    expect(heart.extendQueue).not.toHaveBeenCalled();
    expect(status.playIndex).toBe(0);
  });

  it("退出心动模式时恢复队列和播放位置，并回到列表循环", async () => {
    const status = useStatusStore();
    const media = useMediaStore();
    queueStore.setQueue([track("a"), track("b")]);
    status.playIndex = 1;
    status.repeatMode = "one";
    status.shuffleMode = "on";

    const seed = { ...track("b"), recommended: true, algorithm: "Alg" };
    await playHeartMode([track("c")], seed);
    expect(queueStore.queue.value.map(({ id }) => id)).toEqual(["b", "c"]);
    expect(queueStore.queue.value[0]?.recommended).toBeUndefined();
    expect(queueStore.queue.value[0]?.algorithm).toBeUndefined();
    expect(status.heartMode).toBe(true);
    expect(status.repeatMode).toBe("list");
    expect(status.shuffleMode).toBe("off");

    // 模拟重启：内存快照丢失，只剩持久化副本
    queueStore.previousQueue.value = null;
    await exitHeartMode();

    expect(status.heartMode).toBe(false);
    expect(queueStore.queue.value.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(status.playIndex).toBe(1);
    expect(status.repeatMode).toBe("list");
    expect(status.shuffleMode).toBe("off");
    expect(media.track?.id).toBe("b");
  });
});
