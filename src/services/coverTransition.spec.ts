import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { flushPromises } from "@vue/test-utils";
import {
  captureCover,
  coverTransitionActive,
  getCoverPreview,
  installCoverTransitions,
} from "./coverTransition";

const path = "/collection/streaming/album/album-1?serverId=server-a";
const album = { id: "album-1", title: "测试专辑", cover: "cover://album.jpg", trackCount: 12 };
let dispose: (() => void) | undefined;

/**
 * 使用真实路由和可控快照回调复现导航时序
 * @returns 路由、容器和原生过渡桩
 */
const setupNavigation = async () => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 160, 160),
  );
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(300);
  vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue();
  const scope = document.createElement("main");
  document.body.append(scope);
  const start = vi.fn((update: ViewTransitionUpdateCallback) => {
    const completed = Promise.withResolvers<void>();
    const ready = Promise.resolve().then(update);
    return { ready, finished: completed.promise, skipTransition: completed.resolve };
  });
  Object.assign(document, { startViewTransition: start });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "list", component: {} },
      { path: "/ordinary", component: {} },
      { path: "/collection/:source/:type/:id", name: "collection", component: {} },
      { path: "/artist/:source/:id", name: "artist", component: {} },
    ],
  });
  router.afterEach((to, _from, failure) => {
    if (!failure) {
      scope.innerHTML =
        to.name === "collection" || to.name === "artist"
          ? "<div data-cover-hero><img data-cover-image></div>"
          : '<div data-cover-key="cover"><img data-cover-image></div>';
    }
  });
  await router.push("/");
  dispose = installCoverTransitions(router, () => scope, vi.fn());
  return { router, scope, start };
};

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flushPromises();
  delete (document as Partial<Document>).startViewTransition;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("封面共享过渡回归", () => {
  it.each([path, "/artist/streaming/artist-1?serverId=server-a"])(
    "%s 进入和返回时匹配原始导航，结束后清理状态",
    async (target) => {
      const { router, scope, start } = await setupNavigation();
      captureCover(album, "cover");
      await router.push(target);
      await flushPromises();
      expect(getCoverPreview(target)?.title).toBe(album.title);
      expect(coverTransitionActive.value).toBe(true);
      expect(scope.querySelector("[data-cover-hero][data-cover-shared]")).not.toBeNull();
      start.mock.results[0].value.skipTransition();
      await flushPromises();
      expect(coverTransitionActive.value).toBe(false);
      expect(scope.querySelector("[data-cover-shared]")).toBeNull();
      await router.push("/");
      await flushPromises();
      expect(start).toHaveBeenCalledTimes(2);
      expect(
        scope.querySelector('[data-cover-key="cover"]')!.hasAttribute("data-cover-shared"),
      ).toBe(true);
      start.mock.results[1].value.skipTransition();
      await flushPromises();
      await router.push(target.replace("server-a", "server-b"));
      await router.push("/");
      expect(start).toHaveBeenCalledTimes(2);
    },
  );

  it("普通页面不启用共享过渡，也不将点击摘要留给后续导航", async () => {
    const { router, start } = await setupNavigation();
    captureCover(album, "cover");
    await router.push("/ordinary");
    await router.push(path);
    expect(start).not.toHaveBeenCalled();
    expect(coverTransitionActive.value).toBe(false);
    expect(getCoverPreview(path)).toBeNull();
  });

  it.each(["关闭动画", "缺少原生 API"])("%s 时继续普通导航", async (condition) => {
    const { router, start } = await setupNavigation();
    if (condition === "关闭动画") {
      dispose?.();
      dispose = undefined;
    } else Object.assign(document, { startViewTransition: undefined });
    const timer = vi.spyOn(window, "setTimeout");
    captureCover(album, "cover");
    if (condition === "关闭动画") expect(timer).not.toHaveBeenCalled();
    await router.push(path);
    expect(start).not.toHaveBeenCalled();
    expect(coverTransitionActive.value).toBe(false);
    expect(getCoverPreview(path)).toBeNull();
  });

  it("连续点击时，取消的旧快照回调不能提前提交新导航", async () => {
    const { router, start } = await setupNavigation();
    const updates: ViewTransitionUpdateCallback[] = [];
    start.mockImplementation((update) => {
      updates.push(update);
      const completed = Promise.withResolvers<void>();
      return {
        ready: Promise.resolve(),
        finished: completed.promise,
        skipTransition: completed.resolve,
      };
    });
    captureCover(album, "cover");
    const first = router.push(path);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    captureCover({ ...album, title: "另一个专辑" }, "cover");
    const nextPath = path.replace("album-1", "album-2");
    const second = router.push(nextPath);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    await updates[0]();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/");
    const updating = updates[1]();
    await Promise.all([first, second, updating]);
    expect(router.currentRoute.value.fullPath).toBe(nextPath);
    expect(getCoverPreview(nextPath)?.title).toBe("另一个专辑");
    await router.push("/ordinary");
    expect(coverTransitionActive.value).toBe(false);
    expect(start).toHaveBeenCalledTimes(2);
  });
});
