import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";

const application = vi.hoisted(() => ({
  mountApplication: vi.fn(),
  startApplication: vi.fn(),
}));
vi.mock("./main", () => application);

let finishEntrance: () => void;
let finishMount: () => void;
let finishFade: () => void;
let animate: ReturnType<typeof vi.fn<Element["animate"]>>;
let ready: ReturnType<typeof vi.fn>;
let startupComplete: ReturnType<typeof vi.fn>;
let startupFailed: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML =
    '<div id="app-loading"><img class="splash-logo entrance"><div class="entrance"></div><i></i></div><div id="app" inert aria-hidden="true"></div>';
  const entrance = new Promise<void>((resolve) => (finishEntrance = resolve));
  for (const element of document.querySelectorAll(".entrance")) {
    element.getAnimations = () => [{ finished: entrance } as unknown as Animation];
  }
  document.querySelector("img")!.decode = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: vi.fn().mockResolvedValue([]) },
  });
  const fade = new Promise<void>((resolve) => (finishFade = resolve));
  animate = vi
    .fn<Element["animate"]>()
    .mockReturnValue({ finished: fade, cancel: vi.fn() } as unknown as Animation);
  document.getElementById("app-loading")!.animate = animate;
  application.mountApplication.mockReturnValue(
    new Promise<void>((resolve) => (finishMount = resolve)),
  );
  ready = vi.fn().mockResolvedValue(undefined);
  startupComplete = vi.fn().mockResolvedValue(undefined);
  startupFailed = vi.fn();
  vi.stubGlobal("api", { window: { ready, startupComplete, startupFailed } });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => callback(0));
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("单窗口启动过渡", () => {
  it("首页先挂载时等待完整入场，淡出后才解锁界面并恢复播放", async () => {
    await import("./bootstrap");
    await vi.waitFor(() => expect(application.mountApplication).toHaveBeenCalledOnce());
    expect(ready).toHaveBeenCalledWith();
    finishMount();
    await flushPromises();
    expect(animate).not.toHaveBeenCalled();
    finishEntrance();
    await flushPromises();
    expect(animate).toHaveBeenCalledOnce();
    expect(document.getElementById("app")!.hasAttribute("inert")).toBe(true);
    expect(application.startApplication).not.toHaveBeenCalled();
    finishFade();
    await flushPromises();
    expect(document.getElementById("app-loading")).toBeNull();
    expect(document.getElementById("app")!.inert).toBe(false);
    expect(startupComplete).toHaveBeenCalledOnce();
    expect(application.startApplication).toHaveBeenCalledOnce();
  });

  it("入场先完成时保留启动层，直到首页挂载成功", async () => {
    await import("./bootstrap");
    await vi.waitFor(() => expect(application.mountApplication).toHaveBeenCalledOnce());
    finishEntrance();
    await flushPromises();
    expect(animate).not.toHaveBeenCalled();
    finishMount();
    await flushPromises();
    expect(animate).toHaveBeenCalledOnce();
    finishFade();
    await flushPromises();
  });

  it("减少动态效果时使用零时长淡出", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    await import("./bootstrap");
    await vi.waitFor(() => expect(application.mountApplication).toHaveBeenCalledOnce());
    finishEntrance();
    finishMount();
    await flushPromises();
    expect(animate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ duration: 0 }),
    );
    finishFade();
    await flushPromises();
  });

  it("初始化失败时保留启动层并报告错误，不暴露空界面", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("挂载失败");
    application.mountApplication.mockRejectedValue(error);
    await import("./bootstrap");
    await vi.waitFor(() => expect(startupFailed).toHaveBeenCalledWith(error.stack));
    expect(ready).toHaveBeenCalledExactlyOnceWith();
    expect(startupComplete).not.toHaveBeenCalled();
    expect(document.getElementById("app-loading")).not.toBeNull();
    expect(animate).not.toHaveBeenCalled();
    expect(application.startApplication).not.toHaveBeenCalled();
    finishEntrance();
  });
});
