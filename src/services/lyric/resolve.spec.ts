import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import { useSettingsStore } from "@/stores/settings";

const mockRequestPlatformLyric = vi.fn();

vi.mock("./request", () => ({
  requestPlatformLyric: (...args: unknown[]) => mockRequestPlatformLyric(...args),
  requestStreamingLyric: vi.fn(),
  requestTTMLOverlay: vi.fn(),
}));

const mockWindowApi = {
  desktopLyric: { onConfigChange: vi.fn(() => () => {}) },
  taskbarLyric: { onConfigChange: vi.fn(() => () => {}) },
  dynamicIsland: { onConfigChange: vi.fn(() => () => {}) },
  window: {
    onDesktopLyricVisibilityChange: vi.fn(() => () => {}),
    onDynamicIslandVisibilityChange: vi.fn(() => () => {}),
    onTaskbarLyricVisibilityChange: vi.fn(() => () => {}),
    isDesktopLyricOpen: vi.fn().mockResolvedValue(false),
    isDynamicIslandOpen: vi.fn().mockResolvedValue(false),
    isTaskbarLyricOpen: vi.fn().mockResolvedValue(false),
  },
};

// @ts-expect-error test mock
window.api = mockWindowApi;

import { resolveOnlineByPreference } from "./resolve";

const createTrack = (id: string): Track => ({
  id,
  source: "netease",
  title: `Song ${id}`,
  artists: [{ id: "a1", name: "Artist" }],
  duration: 180_000,
});

describe("resolveOnlineByPreference 平台优先与智能回退", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("偏好平台命中时：优先返回该偏好平台歌词且不查询其他平台", async () => {
    const settings = useSettingsStore();
    settings.lyric.lyricSourcePreference = "kugou";

    mockRequestPlatformLyric.mockImplementation(async (platform: string) => {
      if (platform === "kugou") {
        return {
          platform: "kugou",
          format: "krc",
          content: "[00:01.000]<0,1000>酷狗KRC",
        };
      }
      return null;
    });

    const result = await resolveOnlineByPreference(createTrack("song_hit"), {
      hasLocal: false,
      localFormat: null,
    });

    expect(result).not.toBeNull();
    expect(result?.source.platform).toBe("kugou");
    expect(result?.source.format).toBe("krc");
    expect(mockRequestPlatformLyric).toHaveBeenCalledTimes(1);
    expect(mockRequestPlatformLyric).toHaveBeenCalledWith("kugou", expect.anything());
  });

  it("偏好平台查无此歌时：自动智能回退至其余音源平台成功获取歌词", async () => {
    const settings = useSettingsStore();
    settings.lyric.lyricSourcePreference = "kugou";
    settings.lyric.lyricSourceOrder = ["netease", "qqmusic", "kugou"];

    // 酷狗完全查无此歌，QQ音乐有
    mockRequestPlatformLyric.mockImplementation(async (platform: string) => {
      if (platform === "kugou") return null;
      if (platform === "netease") return null;
      if (platform === "qqmusic") {
        return {
          platform: "qqmusic",
          format: "qrc",
          content: "[1000,1000]QQ音乐QRC(1000,1000)",
        };
      }
      return null;
    });

    const result = await resolveOnlineByPreference(createTrack("song_fallback"), {
      hasLocal: false,
      localFormat: null,
    });

    expect(result).not.toBeNull();
    expect(result?.source.platform).toBe("qqmusic");
    expect(result?.source.format).toBe("qrc");
    // 验证确实先查了酷狗，酷狗没有才查了 netease 和 qqmusic
    expect(mockRequestPlatformLyric).toHaveBeenCalledWith("kugou", expect.anything());
    expect(mockRequestPlatformLyric).toHaveBeenCalledWith("netease", expect.anything());
    expect(mockRequestPlatformLyric).toHaveBeenCalledWith("qqmusic", expect.anything());
  });
});
