import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track, TrackSource } from "@shared/types/player";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";

// Mock preload
const preloadedResult = vi.hoisted(() => ({
  hit: false,
  lyric: null as unknown,
}));

vi.mock("@/services/lyric/preload", () => ({
  consumePreloadedLyric: vi.fn(async () => ({
    hit: preloadedResult.hit,
    lyric: preloadedResult.lyric,
  })),
}));

// Mock resolve 模块，保留真实 isBetterFormat 与其它纯函数
const mockResolveOnlineByPreference = vi.fn();
const mockResolveTTMLOverlay = vi.fn();
const mockResolveLocalRepoLyric = vi.fn();
const mockResolvePluginLyric = vi.fn();
const mockResolveStreamingByPreference = vi.fn();

vi.mock("@/services/lyric/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/lyric/resolve")>();
  return {
    ...actual,
    resolveOnlineByPreference: (...args: unknown[]) => mockResolveOnlineByPreference(...args),
    resolveTTMLOverlay: (...args: unknown[]) => mockResolveTTMLOverlay(...args),
    resolveLocalRepoLyric: (...args: unknown[]) => mockResolveLocalRepoLyric(...args),
    resolvePluginLyric: (...args: unknown[]) => mockResolvePluginLyric(...args),
    resolveStreamingByPreference: (...args: unknown[]) => mockResolveStreamingByPreference(...args),
  };
});

import { loadForTrack } from "./loader";

const createTrack = (id: string, source: TrackSource = "netease"): Track => ({
  id,
  source,
  title: `Song ${id}`,
  artists: [{ id: "a1", name: "Artist" }],
  duration: 180_000,
});

const mockWindowApi = {
  player: {
    readLyricFile: vi.fn().mockResolvedValue({ success: false, data: null }),
  },
  desktopLyric: {
    onConfigChange: vi.fn(() => () => {}),
  },
  taskbarLyric: {
    onConfigChange: vi.fn(() => () => {}),
  },
  dynamicIsland: {
    onConfigChange: vi.fn(() => () => {}),
  },
  window: {
    onDesktopLyricVisibilityChange: vi.fn(() => () => {}),
    onDynamicIslandVisibilityChange: vi.fn(() => () => {}),
    onTaskbarLyricVisibilityChange: vi.fn(() => () => {}),
    isDesktopLyricOpen: vi.fn().mockResolvedValue(false),
    isDynamicIslandOpen: vi.fn().mockResolvedValue(false),
    isTaskbarLyricOpen: vi.fn().mockResolvedValue(false),
  },
  nowPlaying: {
    update: vi.fn(),
    updatePlaybackState: vi.fn(),
    updateLyricLine: vi.fn(),
  },
  plugins: {
    matchLyric: vi.fn(),
  },
};

// @ts-expect-error test mock
window.api = mockWindowApi;

describe("lyric loader", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    preloadedResult.hit = false;
    preloadedResult.lyric = null;

    mockResolveOnlineByPreference.mockResolvedValue(null);
    mockResolveTTMLOverlay.mockResolvedValue(null);
    mockResolveLocalRepoLyric.mockResolvedValue(null);
    mockResolvePluginLyric.mockResolvedValue(null);
    mockResolveStreamingByPreference.mockResolvedValue(null);

    // @ts-expect-error test mock
    window.api = mockWindowApi;
  });

  it("在线多平台并发查询时，先到达的候选歌词立即上屏展示", async () => {
    const media = useMediaStore();
    const track = createTrack("song_1");
    media.track = track;

    mockResolveOnlineByPreference.mockImplementation(
      async (_track, options: { onCandidate?: (res: unknown) => void }) => {
        // 平台 A 先到并触发 onCandidate
        options.onCandidate?.({
          source: { source: "online", format: "lrc", platform: "netease" },
          input: { content: "[00:01.00]平台A优先到达的歌词" },
        });

        // 验证此时界面已立即展示，不需要等后续流程
        expect(media.activeLyric?.format).toBe("lrc");
        expect(media.parsedLyric.length).toBeGreaterThan(0);
        expect(media.parsedLyric[0].words[0].word).toContain("平台A优先到达的歌词");

        return {
          source: { source: "online", format: "lrc", platform: "netease" },
          input: { content: "[00:01.00]平台A优先到达的歌词" },
        };
      },
    );

    await loadForTrack(null);
    expect(media.activeLyric?.format).toBe("lrc");
  });

  it("防降级保护：已展示高优先级逐词格式时，迟到的普通文本 LRC 无法覆盖降级", async () => {
    const media = useMediaStore();
    const track = createTrack("song_2");
    media.track = track;

    mockResolveOnlineByPreference.mockImplementation(
      async (_track, options: { onCandidate?: (res: unknown) => void }) => {
        // 优质歌词 QRC 先到
        options.onCandidate?.({
          source: { source: "online", format: "qrc", platform: "qqmusic" },
          input: { content: "[1000,1000]优质逐词歌词(1000,1000)" },
        });
        expect(media.activeLyric?.format).toBe("qrc");

        // 迟到的普通 LRC 试图通过 onCandidate 提交
        options.onCandidate?.({
          source: { source: "online", format: "lrc", platform: "kugou" },
          input: { content: "[00:01.00]迟到的普通LRC" },
        });

        // 必须被拦截，保持 QRC
        expect(media.activeLyric?.format).toBe("qrc");

        return {
          source: { source: "online", format: "lrc", platform: "kugou" },
          input: { content: "[00:01.00]迟到的普通LRC" },
        };
      },
    );

    await loadForTrack(null);
    // 最终状态依然必须是优质的 QRC
    expect(media.activeLyric?.format).toBe("qrc");
  });

  it("格式升级：已展示普通 LRC 时，后到达的高优先级格式能够平滑热替换", async () => {
    const media = useMediaStore();
    const track = createTrack("song_3");
    media.track = track;

    mockResolveOnlineByPreference.mockImplementation(
      async (_track, options: { onCandidate?: (res: unknown) => void }) => {
        // 普通 LRC 先到
        options.onCandidate?.({
          source: { source: "online", format: "lrc", platform: "netease" },
          input: { content: "[00:01.00]普通LRC" },
        });
        expect(media.activeLyric?.format).toBe("lrc");

        // 逐词 QRC 后到
        options.onCandidate?.({
          source: { source: "online", format: "qrc", platform: "qqmusic" },
          input: { content: "[1000,1000]逐词QRC(1000,1000)" },
        });
        expect(media.activeLyric?.format).toBe("qrc");

        return {
          source: { source: "online", format: "qrc", platform: "qqmusic" },
          input: { content: "[1000,1000]逐词QRC(1000,1000)" },
        };
      },
    );

    await loadForTrack(null);
    expect(media.activeLyric?.format).toBe("qrc");
  });

  it("TTML 异步非阻塞：基础歌词立即展示，后台 TTML 完成后平滑热替换升级", async () => {
    const media = useMediaStore();
    const track = createTrack("song_4");
    media.track = track;

    let resolveTTMLPromise!: (val: unknown) => void;
    const ttmlPromise = new Promise((resolve) => {
      resolveTTMLPromise = resolve;
    });

    mockResolveOnlineByPreference.mockResolvedValue({
      source: { source: "online", format: "lrc", platform: "netease" },
      input: { content: "[00:01.00]基础在线歌词" },
    });
    mockResolveTTMLOverlay.mockReturnValue(ttmlPromise);

    const loadPromise = loadForTrack(null);
    await loadPromise;

    // loadForTrack 已结束，基础歌词已经上屏，无需等待 TTML
    expect(media.activeLyric?.format).toBe("lrc");
    expect(media.parsedLyric[0].words[0].word).toContain("基础在线歌词");

    // TTML 在后台异步返回有效内容
    const validTTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="00:01.00" end="00:05.00"><span begin="00:01.00" end="00:05.00">TTML歌词内容</span></p>
    </div>
  </body>
</tt>`;

    resolveTTMLPromise({
      source: { source: "online", format: "ttml", platform: "netease" },
      input: { content: validTTML },
    });

    // 等待异步 promise 完成
    await vi.waitFor(() => {
      expect(media.activeLyric?.format).toBe("ttml");
    });
    expect(media.parsedLyric[0].words[0].word).toContain("TTML歌词内容");
  });

  it("防白屏保护：后台 TTML 返回空内容或畸形无效数据时，保留当前已展示歌词", async () => {
    const media = useMediaStore();
    const track = createTrack("song_5");
    media.track = track;

    let resolveTTMLPromise!: (val: unknown) => void;
    const ttmlPromise = new Promise((resolve) => {
      resolveTTMLPromise = resolve;
    });

    mockResolveOnlineByPreference.mockResolvedValue({
      source: { source: "online", format: "lrc", platform: "netease" },
      input: { content: "[00:01.00]现有有效歌词" },
    });
    mockResolveTTMLOverlay.mockReturnValue(ttmlPromise);

    await loadForTrack(null);
    expect(media.activeLyric?.format).toBe("lrc");

    // TTML 返回了畸形/空内容
    resolveTTMLPromise({
      source: { source: "online", format: "ttml", platform: "netease" },
      input: { content: "这是完全无法解析出时间轴的无效内容" },
    });

    // 必须保留原有有效歌词，不能变成 null 或清空白屏
    await vi.waitFor(() => {
      expect(media.activeLyric?.format).toBe("lrc");
    });
    expect(media.parsedLyric.length).toBeGreaterThan(0);
    expect(media.parsedLyric[0].words[0].word).toContain("现有有效歌词");

    // 回滚必须经 setLyric 重新同步主进程，最后一次推送携带恢复后的歌词
    const lastCall = mockWindowApi.nowPlaying.update.mock.lastCall;
    expect(lastCall?.[0].lyric.length).toBeGreaterThan(0);
    expect(lastCall?.[0].lyric[0].words[0].word).toContain("现有有效歌词");
  });

  it("本地 TTML 歌词库具有最高优先级，命中时直接展示并跳过在线查询", async () => {
    const media = useMediaStore();
    const track = createTrack("song_6");
    media.track = track;

    mockResolveLocalRepoLyric.mockResolvedValue({
      source: { source: "external", format: "ttml" },
      input: {
        content: `<?xml version="1.0" encoding="utf-8"?><tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:01.00" end="00:03.00"><span begin="00:01.00" end="00:03.00">本地TTML库歌词</span></p></div></body></tt>`,
      },
    });

    await loadForTrack(null);

    expect(media.activeLyric?.source).toBe("external");
    expect(media.activeLyric?.format).toBe("ttml");
    expect(media.parsedLyric[0].words[0].word).toContain("本地TTML库歌词");
    // 不应触发在线查询
    expect(mockResolveOnlineByPreference).not.toHaveBeenCalled();
  });

  it("插件歌词优选：开启插件优先时，插件较快返回可率先上屏展示", async () => {
    const settings = useSettingsStore();
    settings.lyric.preferPluginLyric = true;

    const media = useMediaStore();
    const track = createTrack("song_7");
    media.track = track;

    mockResolvePluginLyric.mockResolvedValue({
      source: { source: "online", format: "lrc" },
      input: { content: "[00:01.00]插件极速歌词" },
    });

    mockResolveOnlineByPreference.mockImplementation(async () => {
      // 模拟内置平台较慢，等插件执行完
      await Promise.resolve();
      return null;
    });

    await loadForTrack(null);

    expect(media.activeLyric).not.toBeNull();
    expect(media.parsedLyric[0].words[0].word).toContain("插件极速歌词");
  });

  it("TTML 拉取去重：onCandidate 与最终结果先后到达时，仅发起一次 TTML 请求", async () => {
    const media = useMediaStore();
    media.track = createTrack("song_8");

    mockResolveOnlineByPreference.mockImplementation(
      async (_track, options: { onCandidate?: (res: unknown) => void }) => {
        // 候选 LRC 先到并上屏，触发一次 TTML
        options.onCandidate?.({
          source: { source: "online", format: "lrc", platform: "netease" },
          input: { content: "[00:01.00]先到的LRC" },
        });
        // 最终结果 QRC 更优，再次走到 TTML 触发点
        return {
          source: { source: "online", format: "qrc", platform: "qqmusic" },
          input: { content: "[1000,1000]更优的QRC(1000,1000)" },
        };
      },
    );

    await loadForTrack(null);

    expect(media.activeLyric?.format).toBe("qrc");
    expect(mockResolveTTMLOverlay).toHaveBeenCalledTimes(1);
  });

  it("插件优选防降级：插件优质歌词先上屏，内置平台迟到的普通 LRC 不覆盖", async () => {
    const settings = useSettingsStore();
    settings.lyric.preferPluginLyric = true;

    const media = useMediaStore();
    media.track = createTrack("song_9");

    mockResolvePluginLyric.mockResolvedValue({
      source: { source: "online", format: "qrc" },
      input: { content: "[1000,1000]插件优质QRC(1000,1000)" },
    });
    mockResolveOnlineByPreference.mockResolvedValue({
      source: { source: "online", format: "lrc", platform: "netease" },
      input: { content: "[00:01.00]内置普通LRC" },
    });

    await loadForTrack(null);

    expect(media.activeLyric?.format).toBe("qrc");
    expect(media.parsedLyric[0].words[0].word).toContain("插件优质QRC");
  });

  it("插件优选可被升级：插件普通 LRC 先上屏，内置平台更优 QRC 后到时热替换", async () => {
    const settings = useSettingsStore();
    settings.lyric.preferPluginLyric = true;

    const media = useMediaStore();
    media.track = createTrack("song_10");

    mockResolvePluginLyric.mockResolvedValue({
      source: { source: "online", format: "lrc" },
      input: { content: "[00:01.00]插件普通LRC" },
    });
    mockResolveOnlineByPreference.mockResolvedValue({
      source: { source: "online", format: "qrc", platform: "qqmusic" },
      input: { content: "[1000,1000]内置优质QRC(1000,1000)" },
    });

    await loadForTrack(null);

    expect(media.activeLyric?.format).toBe("qrc");
    expect(media.parsedLyric[0].words[0].word).toContain("内置优质QRC");
  });

  it("切歌竞态 Token 隔离：快速切歌时，上一首延迟到达的响应绝不污染新歌", async () => {
    const media = useMediaStore();

    let resolveSongA!: (val: unknown) => void;
    const promiseA = new Promise((resolve) => {
      resolveSongA = resolve;
    });

    mockResolveOnlineByPreference.mockImplementation(async (track: Track) => {
      if (track.id === "song_A") {
        return promiseA;
      }
      return {
        source: { source: "online", format: "lrc", platform: "netease" },
        input: { content: "[00:01.00]歌曲B的歌词" },
      };
    });

    // 歌曲 A
    media.track = createTrack("song_A");
    const loadPromiseA = loadForTrack(null);

    // 快速切到歌曲 B
    media.track = createTrack("song_B");
    await loadForTrack(null);
    expect(media.parsedLyric[0].words[0].word).toContain("歌曲B的歌词");

    // 此时歌曲 A 迟到了很久才返回
    resolveSongA({
      source: { source: "online", format: "qrc", platform: "qqmusic" },
      input: { content: "[1000,1000]歌曲A迟到的歌词(1000,1000)" },
    });
    await loadPromiseA;

    // 状态必须依然属于歌曲 B，绝不能被歌曲 A 覆盖
    expect(media.parsedLyric[0].words[0].word).toContain("歌曲B的歌词");
  });

  it("偏好指定平台：当前展示高优先级 QRC 时，切换偏好为酷狗 (KRC) 必须成功替换展示", async () => {
    const settings = useSettingsStore();
    const media = useMediaStore();
    const track = createTrack("song_pref_switch");
    media.track = track;

    // 先加载 QQ 音乐的 QRC
    mockResolveOnlineByPreference.mockResolvedValue({
      source: { source: "online", format: "qrc", platform: "qqmusic" },
      input: { content: "[1000,1000]QQ音乐QRC歌词(1000,1000)" },
    });
    await loadForTrack(null);
    expect(media.activeLyric?.format).toBe("qrc");
    expect(media.activeLyric?.platform).toBe("qqmusic");

    // 用户在播放器中点击切换偏好为酷狗音乐 (KRC)
    mockResolveOnlineByPreference.mockResolvedValue({
      source: { source: "online", format: "krc", platform: "kugou" },
      input: { content: "[00:01.000]<0,1000>酷狗音乐KRC歌词" },
    });
    settings.lyric.lyricSourcePreference = "kugou";

    await vi.waitFor(() => {
      expect(media.activeLyric?.format).toBe("krc");
    });
    expect(media.activeLyric?.platform).toBe("kugou");
    expect(media.parsedLyric[0].words[0].word).toContain("酷狗音乐KRC歌词");
  });

  it("显式平台指令：显式指定平台时即便仅有普通 LRC 也强制生效展示", async () => {
    const settings = useSettingsStore();
    const media = useMediaStore();
    const track = createTrack("song_lrc_pref");
    media.track = track;

    mockResolveOnlineByPreference.mockResolvedValue({
      source: { source: "online", format: "qrc", platform: "qqmusic" },
      input: { content: "[1000,1000]原优质QRC(1000,1000)" },
    });
    await loadForTrack(null);
    expect(media.activeLyric?.format).toBe("qrc");

    mockResolveOnlineByPreference.mockResolvedValue({
      source: { source: "online", format: "lrc", platform: "netease" },
      input: { content: "[00:01.00]网易云普通LRC歌词" },
    });
    settings.lyric.lyricSourcePreference = "netease";

    await vi.waitFor(() => {
      expect(media.activeLyric?.format).toBe("lrc");
    });
    expect(media.activeLyric?.platform).toBe("netease");
    expect(media.parsedLyric[0].words[0].word).toContain("网易云普通LRC歌词");
  });

  it("跟随自身：当前展示他站高优先级时，切换为跟随自身必须替换为自身平台歌词", async () => {
    const settings = useSettingsStore();
    const media = useMediaStore();
    const track = createTrack("song_self_switch");
    media.track = track;

    mockResolveOnlineByPreference.mockResolvedValue({
      source: { source: "online", format: "qrc", platform: "qqmusic" },
      input: { content: "[1000,1000]他站优质QRC(1000,1000)" },
    });
    await loadForTrack(null);
    expect(media.activeLyric?.format).toBe("qrc");

    mockResolveOnlineByPreference.mockResolvedValue({
      source: { source: "online", format: "lrc", platform: "netease" },
      input: { content: "[00:01.00]自身平台普通LRC歌词" },
    });
    settings.lyric.lyricSourcePreference = "self";

    await vi.waitFor(() => {
      expect(media.activeLyric?.format).toBe("lrc");
    });
    expect(media.activeLyric?.platform).toBe("netease");
    expect(media.parsedLyric[0].words[0].word).toContain("自身平台普通LRC歌词");
  });
});
