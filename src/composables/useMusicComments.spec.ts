import { effectScope, nextTick, ref, type Ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

type CreatorResult = { ok: true; data: never[] } | { ok: false; error: string };

const api = vi.hoisted(() => ({
  sources: vi.fn(async () => [{ id: "builtin:netease", name: "网易云", kind: "builtin" }]),
  get: vi.fn(),
  creator: vi.fn<() => Promise<CreatorResult>>(async () => ({ ok: true, data: [] })),
}));

vi.stubGlobal("window", { api: { comments: api } });
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useToast", () => ({ toast: { error: vi.fn() } }));

const { useMusicComments } = await import("./useMusicComments");

const track = (id: string): Track => ({
  id,
  source: "netease",
  title: `歌名${id}`,
  artists: [],
  duration: 0,
});

const pageOf = (ids: string[], overrides: Record<string, unknown> = {}) => ({
  list: ids.map((id) => ({ id, userName: id, text: id })),
  total: ids.length,
  page: 1,
  limit: 20,
  hasMore: false,
  ...overrides,
});

/**
 * 在独立作用域内运行 composable，便于统一销毁
 * @param trackRef - 曲目引用
 * @returns 作用域内的返回值与销毁函数
 */
const setup = (trackRef: Ref<Track | null>, creatorEnabled = true) => {
  const scope = effectScope();
  const result = scope.run(() =>
    useMusicComments(trackRef, ref<HTMLElement | null>(null), ref(creatorEnabled)),
  )!;
  return { ...result, stop: () => scope.stop() };
};

/**
 * 等待初始加载链路完成
 * @returns 无
 */
const settle = async (): Promise<void> => {
  for (let round = 0; round < 5; round++) {
    await Promise.resolve();
    await nextTick();
  }
};

describe("评论数据层", () => {
  beforeEach(() => {
    api.sources.mockClear();
    api.get.mockReset();
    api.creator.mockClear();
    api.get.mockResolvedValue({ ok: true, data: pageOf(["1", "2"]) });
  });

  it("请求进行中切换曲目后丢弃过期响应", async () => {
    let resolveFirst!: (value: unknown) => void;
    api.get
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({ ok: true, data: pageOf(["9"]) });

    const trackRef = ref<Track | null>(track("a"));
    const comments = setup(trackRef);
    trackRef.value = track("b");
    await settle();
    resolveFirst({ ok: true, data: pageOf(["1", "2"]) });
    await settle();

    expect(comments.page.value.list.map((entry) => entry.id)).toEqual(["9"]);
    comments.stop();
  });

  it("追加时带上已保存的游标", async () => {
    api.get
      .mockResolvedValueOnce({ ok: true, data: pageOf(["1"], { hasMore: true, nextCursor: "c1" }) })
      .mockResolvedValue({ ok: true, data: pageOf(["2"], { hasMore: false }) });
    const trackRef = ref<Track | null>(track("a"));
    const comments = setup(trackRef);
    await settle();
    await comments.loadMore();
    const lastCall = api.get.mock.calls.at(-1)?.[0];
    expect(lastCall?.cursor).toBe("c1");
    expect(lastCall?.page).toBe(2);
    comments.stop();
  });

  it("主创说关闭时不请求主创接口", async () => {
    const trackRef = ref<Track | null>(track("a"));
    const comments = setup(trackRef, false);
    await settle();
    expect(api.creator).not.toHaveBeenCalled();
    expect(comments.creatorComments.value).toEqual([]);
    comments.stop();
  });

  it("主创说失败时写入错误并可重试", async () => {
    api.creator.mockResolvedValueOnce({ ok: false, error: "boom" });
    api.creator.mockResolvedValue({ ok: true, data: [] });
    const trackRef = ref<Track | null>(track("a"));
    const comments = setup(trackRef);
    await settle();
    expect(comments.creatorError.value).toBe("boom");
    await comments.retryCreator();
    expect(comments.creatorError.value).toBe("");
    comments.stop();
  });

  it("热评为空而最新非空时切换到最新", async () => {
    api.get.mockImplementation(async (args: { type: string }) => ({
      ok: true,
      data:
        args.type === "hot"
          ? { list: [], total: 0, page: 1, limit: 20, hasMore: false }
          : { list: [{ id: "1", userName: "u", text: "t" }], total: 1, page: 1, limit: 20 },
    }));
    const trackRef = ref<Track | null>(track("a"));
    const comments = setup(trackRef);
    await settle();
    expect(comments.activeTab.value).toBe("new");
    comments.stop();
  });
});
