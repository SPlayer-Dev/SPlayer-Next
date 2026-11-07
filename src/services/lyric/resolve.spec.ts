import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import { useSettingsStore } from "@/stores/settings";

const mockRequestPlatformLyric = vi.fn();
const mockRequestStreamingLyric = vi.fn();
const mockForgetMatch = vi.fn();
const mockConvertBatch = vi.fn();

vi.mock("./request", () => ({
  requestPlatformLyric: (...args: unknown[]) => mockRequestPlatformLyric(...args),
  requestStreamingLyric: (...args: unknown[]) => mockRequestStreamingLyric(...args),
  requestTTMLOverlay: vi.fn(),
}));

const mockGetManualMatch = vi.fn();
const mockMatchById = vi.fn();
const mockMatchLocalTTML = vi.fn();
const mockFetchTTMLById = vi.fn();
const mockSearchCandidates = vi.fn();
const mockRememberMatch = vi.fn();

const mockWindowApi = {
  lyrics: {
    fetchTTMLById: (...args: unknown[]) => mockFetchTTMLById(...args),
    forgetMatch: (...args: unknown[]) => mockForgetMatch(...args),
    getManualMatch: (...args: unknown[]) => mockGetManualMatch(...args),
    matchById: (...args: unknown[]) => mockMatchById(...args),
    matchLocalTTML: (...args: unknown[]) => mockMatchLocalTTML(...args),
    rememberMatch: (...args: unknown[]) => mockRememberMatch(...args),
    searchCandidates: (...args: unknown[]) => mockSearchCandidates(...args),
  },
  opencc: { convertBatch: (...args: unknown[]) => mockConvertBatch(...args) },
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

import {
  resolveOnlineByPreference,
  resolveStreamingByPreference,
  resolveUserLyric,
} from "./resolve";

const createTrack = (id: string): Track => ({
  id,
  source: "netease",
  title: `Song ${id}`,
  artists: [{ id: "a1", name: "Artist" }],
  duration: 180_000,
});

const createLocalTrack = (source: Track["source"] = "local"): Track => ({
  ...createTrack("track"),
  source,
  serverId: "server",
  originalId: "original",
});

/** 生成只有行级时间的 TTML 歌词 */
const plainTTML = (): string => {
  const lines = Array.from({ length: 12 }, (_, index) => {
    const begin = (1 + index * 4).toFixed(2);
    const end = (4 + index * 4).toFixed(2);
    const text = `line${index} alpha${index} bravo${index} charlie${index}`;
    return `<p begin="${begin}s" end="${end}s">${text}</p>`;
  });
  return `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${lines.join("")}</div></body></tt>`;
};

describe("resolveUserLyric 手动选择优先", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    const settings = useSettingsStore();
    settings.system.localLyric.enableLocalTTMLOverride = true;
    settings.system.localLyric.repoDir = "D:/lyrics";
    mockMatchLocalTTML.mockResolvedValue({ ok: true, data: "<tt></tt>" });
  });

  it("命中手动选择时优先于本地歌词库，并用候选的歌名和时长取词", async () => {
    mockGetManualMatch.mockResolvedValue({
      platform: "kugou",
      id: "hash",
      name: "候选歌名",
      artist: "Artist",
      duration: 200_000,
    });
    mockMatchById.mockResolvedValue({
      ok: true,
      data: { platform: "kugou", format: "krc", content: "krc" },
    });

    const result = await resolveUserLyric(createTrack("song"));

    expect(result).toMatchObject({
      pinned: true,
      source: { source: "online", platform: "kugou", format: "krc" },
    });
    expect(mockMatchById).toHaveBeenCalledWith(
      "kugou",
      "hash",
      expect.objectContaining({ title: "候选歌名", duration: 200_000 }),
      false,
    );
    expect(mockMatchLocalTTML).not.toHaveBeenCalled();
  });

  it("手动选择 TTML 时按 AMLL id 取词", async () => {
    mockGetManualMatch.mockResolvedValue({
      platform: "ttml",
      id: "719",
      name: "候选歌名",
      artist: "Artist",
    });
    mockFetchTTMLById.mockResolvedValue({ ok: true, data: "<tt>manual</tt>" });

    const result = await resolveUserLyric(createTrack("song"));

    expect(result).toEqual({
      pinned: true,
      source: { source: "online", format: "ttml" },
      input: { content: "<tt>manual</tt>" },
    });
    expect(mockFetchTTMLById).toHaveBeenCalledWith("719");
    expect(mockMatchById).not.toHaveBeenCalled();
  });

  it("没有手动选择时回退本地歌词库", async () => {
    mockGetManualMatch.mockResolvedValue(null);

    const result = await resolveUserLyric(createTrack("song"));

    expect(result?.source).toEqual({ source: "external", format: "ttml" });
    expect(mockMatchById).not.toHaveBeenCalled();
  });

  it("手动选择的歌词取不到时回退本地歌词库", async () => {
    mockGetManualMatch.mockResolvedValue({
      platform: "netease",
      id: "1",
      name: "Song",
      artist: "Artist",
    });
    mockMatchById.mockResolvedValue({ ok: false, error: "network" });

    const result = await resolveUserLyric(createTrack("song"));

    expect(result?.source).toEqual({ source: "external", format: "ttml" });
  });
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
          content: "[00:01.000]<0,1000>KGKRC",
        };
      }
      return null;
    });

    const result = await resolveOnlineByPreference(createTrack("song_hit"));

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

    // KG完全查无此歌，QM有
    mockRequestPlatformLyric.mockImplementation(async (platform: string) => {
      if (platform === "kugou") return null;
      if (platform === "netease") return null;
      if (platform === "qqmusic") {
        return {
          platform: "qqmusic",
          format: "qrc",
          content: "[1000,1000]QMQRC(1000,1000)",
        };
      }
      return null;
    });

    const result = await resolveOnlineByPreference(createTrack("song_fallback"));

    expect(result).not.toBeNull();
    expect(result?.source.platform).toBe("qqmusic");
    expect(result?.source.format).toBe("qrc");
    // 验证确实先查了KG，KG没有才查了 netease 和 qqmusic
    expect(mockRequestPlatformLyric).toHaveBeenCalledWith("kugou", expect.anything());
    expect(mockRequestPlatformLyric).toHaveBeenCalledWith("netease", expect.anything());
    expect(mockRequestPlatformLyric).toHaveBeenCalledWith("qqmusic", expect.anything());
  });
});

/** 生成基准用的逐行歌词 */
const plainLyric = (prefix = "line", offsetMs = 0): string =>
  Array.from({ length: 12 }, (_, index) => {
    const start = 1000 + index * 4000 + offsetMs;
    const seconds = (start / 1000).toFixed(2).padStart(5, "0");
    return `[00:${seconds}]${prefix}${index} ${prefix}alpha${index} ${prefix}bravo${index} ${prefix}charlie${index}`;
  }).join("\n");

/** 生成带真实逐字时间的 QRC 歌词 */
const timedLyric = (prefix = "line", offsetMs = 0): string =>
  Array.from({ length: 12 }, (_, index) => {
    const start = 1000 + index * 4000 + offsetMs;
    const words = [
      `${prefix}${index} `,
      `${prefix}alpha${index} `,
      `${prefix}bravo${index} `,
      `${prefix}charlie${index}`,
    ];
    const timed = words.map((word, position) => `${word}(${start + position * 500},500)`);
    return `[${start},2000]${timed.join("")}`;
  }).join("\n");

/** 让 mock 按平台返回指定歌词 */
const mockPlatforms = (
  lyrics: Partial<Record<string, { format: string; content: string } | Promise<unknown>>>,
): void => {
  mockRequestPlatformLyric.mockImplementation(async (platform: string) => {
    const entry = await lyrics[platform];
    return entry ? { platform, ...(entry as object) } : null;
  });
};

describe("resolveOnlineByPreference 候选验证", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockForgetMatch.mockReset();
    mockSearchCandidates.mockReset();
    mockSearchCandidates.mockResolvedValue({ ok: true, data: [] });
    mockMatchById.mockReset();
    mockConvertBatch.mockReset();
    mockConvertBatch.mockImplementation(async (texts: string[]) => texts);
    const settings = useSettingsStore();
    settings.lyric.lyricSourcePreference = "auto";
    settings.lyric.smartPreferOnline = true;
    settings.lyric.lyricSourceOrder = ["netease", "qqmusic", "kugou"];
  });

  it("自身平台歌词先上屏，同版本的更优候选只再替换一次", async () => {
    mockPlatforms({
      netease: { format: "lrc", content: plainLyric() },
      qqmusic: { format: "qrc", content: timedLyric() },
      kugou: { format: "lrc", content: plainLyric() },
    });
    const committed: string[] = [];

    const result = await resolveOnlineByPreference(createTrack("song"), {
      onCandidate: (lyric) => committed.push(lyric.source.format),
    });

    expect(committed).toEqual(["lrc", "qrc"]);
    expect(result?.source.platform).toBe("qqmusic");
  });

  it("更优候选还在简繁复核时，其他候选不抢先替换", async () => {
    let releaseKugou: (lyric: { format: string; content: string }) => void = () => {};
    const kugouLyric = new Promise((resolve) => (releaseKugou = resolve));
    // QRC 与 KRC 的逐字结构可以互相改写，文本保持一致
    const krcContent = timedLyric().replace(
      /([^\s()\]]+ ?)\((\d+),500\)/g,
      (_, word: string, start: string) => `<${(Number(start) - 1000) % 4000},500,0>${word}`,
    );
    mockConvertBatch.mockImplementation(async (texts: string[]) => {
      releaseKugou({ format: "krc", content: krcContent });
      await new Promise((resolve) => setTimeout(resolve, 10));
      return texts.map((text) => text.replaceAll("other", "line"));
    });
    mockPlatforms({
      netease: { format: "lrc", content: plainLyric() },
      qqmusic: { format: "qrc", content: timedLyric("other") },
      kugou: kugouLyric,
    });
    const committed: string[] = [];

    const result = await resolveOnlineByPreference(createTrack("song"), {
      onCandidate: (lyric) => committed.push(lyric.source.format),
    });

    expect(committed).toEqual(["lrc", "qrc"]);
    expect(result?.source.platform).toBe("qqmusic");
  });

  it("内容不同的候选即使格式更优也被拒绝，并清除错误匹配", async () => {
    mockPlatforms({
      netease: { format: "lrc", content: plainLyric() },
      qqmusic: { format: "qrc", content: timedLyric("other") },
    });

    const result = await resolveOnlineByPreference(createTrack("song"));

    expect(result?.source.platform).toBe("netease");
    expect(mockForgetMatch).toHaveBeenCalledWith(expect.anything(), "qqmusic");
  });

  it("最佳候选被拒绝时改用同平台通过验证的其他版本，并记住它", async () => {
    mockPlatforms({
      netease: { format: "lrc", content: plainLyric() },
      qqmusic: { format: "qrc", content: timedLyric("other") },
    });
    mockSearchCandidates.mockResolvedValue({
      ok: true,
      data: [
        {
          platform: "qqmusic",
          id: "best",
          name: "Song song",
          artist: "Artist",
          tags: ["name", "artist"],
          best: true,
          autoMatched: false,
        },
        {
          platform: "qqmusic",
          id: "alt",
          name: "Song song (Version)",
          artist: "Artist",
          tags: ["name", "artist"],
          best: false,
          autoMatched: false,
        },
      ],
    });
    mockMatchById.mockResolvedValue({
      ok: true,
      data: { platform: "qqmusic", format: "qrc", content: timedLyric() },
    });
    const track = createTrack("song");

    const result = await resolveOnlineByPreference(track);

    expect(result?.source.platform).toBe("qqmusic");
    expect(result?.source.format).toBe("qrc");
    expect(mockMatchById).toHaveBeenCalledTimes(1);
    expect(mockMatchById).toHaveBeenCalledWith("qqmusic", "alt", expect.anything(), false);
    expect(mockRememberMatch).toHaveBeenCalledWith(track, "qqmusic", "alt");
  });

  it("基准不足以判断时保留基准", async () => {
    mockPlatforms({
      netease: { format: "lrc", content: "[00:01.00]纯音乐，请欣赏" },
      qqmusic: { format: "qrc", content: timedLyric() },
    });

    const result = await resolveOnlineByPreference(createTrack("song"));

    expect(result?.source.platform).toBe("netease");
    expect(mockForgetMatch).not.toHaveBeenCalled();
  });

  it("候选没有真实逐字时间时不算升级", async () => {
    mockPlatforms({
      netease: { format: "lrc", content: plainLyric() },
      qqmusic: { format: "ttml", content: plainTTML() },
    });

    const result = await resolveOnlineByPreference(createTrack("song"));

    expect(result?.source.platform).toBe("netease");
  });

  it("时间整体偏移的候选带上校正量", async () => {
    mockPlatforms({
      netease: { format: "lrc", content: plainLyric() },
      qqmusic: { format: "qrc", content: timedLyric("line", 3000) },
    });

    const result = await resolveOnlineByPreference(createTrack("song"));

    expect(result?.source.platform).toBe("qqmusic");
    expect(result?.source.timeShiftMs).toBe(-3000);
  });

  it("偏移过大的候选被拒绝", async () => {
    mockPlatforms({
      netease: { format: "lrc", content: plainLyric() },
      qqmusic: { format: "qrc", content: timedLyric("line", 20_000) },
    });

    const result = await resolveOnlineByPreference(createTrack("song"));

    expect(result?.source.platform).toBe("netease");
  });

  it("简繁不同的同版本候选在转换后通过", async () => {
    const baseline = plainLyric("愛");
    mockPlatforms({
      netease: { format: "lrc", content: baseline.replaceAll("愛", "爱") },
      qqmusic: { format: "qrc", content: timedLyric("愛") },
    });
    mockConvertBatch.mockImplementation(async (texts: string[]) =>
      texts.map((text) => text.replaceAll("愛", "爱")),
    );

    const result = await resolveOnlineByPreference(createTrack("song"));

    expect(result?.source.platform).toBe("qqmusic");
    expect(mockConvertBatch).toHaveBeenCalledWith(expect.anything(), "t2s");
  });

  it("没有基准时按格式接受候选，保持现有行为", async () => {
    mockPlatforms({ qqmusic: { format: "qrc", content: timedLyric("other") } });

    const result = await resolveOnlineByPreference(createTrack("song"));

    expect(result?.source.platform).toBe("qqmusic");
  });

  it("等待自身平台返回前不提交其他平台候选", async () => {
    let resolveOwn!: (value: unknown) => void;
    mockPlatforms({
      netease: new Promise((resolve) => {
        resolveOwn = resolve;
      }),
      qqmusic: { format: "qrc", content: timedLyric() },
    });
    const committed: string[] = [];

    const pending = resolveOnlineByPreference(createTrack("song"), {
      onCandidate: (lyric) => committed.push(lyric.source.format),
    });
    await new Promise((resolve) => setTimeout(resolve));
    expect(committed).toEqual([]);

    resolveOwn({ format: "lrc", content: plainLyric() });
    await pending;
    expect(committed).toEqual(["lrc", "qrc"]);
  });

  it("其余平台不可能更优时立即提交，不等慢平台", async () => {
    mockPlatforms({
      netease: { format: "lrc", content: plainLyric() },
      qqmusic: { format: "qrc", content: timedLyric() },
      kugou: new Promise(() => {}),
    });
    const committed: string[] = [];

    void resolveOnlineByPreference(createTrack("song"), {
      onCandidate: (lyric) => committed.push(lyric.source.format),
    });

    await vi.waitFor(() => expect(committed).toEqual(["lrc", "qrc"]));
  });

  it("顺序模式命中不可超越的结果后不再请求后续平台", async () => {
    mockPlatforms({
      netease: { format: "lrc", content: plainLyric() },
      qqmusic: { format: "qrc", content: timedLyric() },
      kugou: { format: "krc", content: "" },
    });

    const result = await resolveOnlineByPreference(createTrack("song"), { sequential: true });

    expect(result?.source.platform).toBe("qqmusic");
    expect(mockRequestPlatformLyric).toHaveBeenCalledTimes(2);
  });

  it("本地歌词作为基准，内容不同的在线歌词不覆盖", async () => {
    mockPlatforms({ qqmusic: { format: "qrc", content: timedLyric("other") } });

    const result = await resolveOnlineByPreference(createLocalTrack(), {
      local: {
        source: { source: "external", format: "lrc" },
        input: { content: plainLyric() },
      },
    });

    expect(result).toBeNull();
  });

  it("关闭自动升级时自身平台优先，命中即结束", async () => {
    useSettingsStore().lyric.smartPreferOnline = false;
    mockPlatforms({
      netease: { format: "yrc", content: "" },
      qqmusic: { format: "lrc", content: plainLyric() },
    });

    const result = await resolveOnlineByPreference({ ...createTrack("song"), source: "qqmusic" });

    expect(result?.source.platform).toBe("qqmusic");
    expect(mockRequestPlatformLyric).toHaveBeenCalledTimes(1);
  });
});

describe("resolveStreamingByPreference", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    useSettingsStore().lyric.smartPreferOnline = true;
  });

  it("服务端歌词到达后立即提交，不等在线平台", async () => {
    mockRequestStreamingLyric.mockResolvedValue(plainLyric());
    mockRequestPlatformLyric.mockReturnValue(new Promise(() => {}));
    const committed: string[] = [];

    void resolveStreamingByPreference(createLocalTrack("streaming"), {
      onCandidate: (lyric) => committed.push(lyric.source.source),
    });

    await vi.waitFor(() => expect(committed).toEqual(["external"]));
  });
});
