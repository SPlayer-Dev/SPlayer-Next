import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import type { UpdateEvent, UpdateState } from "@shared/types/update";

const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: mocks }));
vi.mock("@/i18n", () => ({ default: { global: { t: (key: string) => key } } }));
const initial: UpdateState = {
  revision: 1,
  channel: "stable",
  phase: "idle",
  mode: "inApp",
  meta: null,
  percent: 0,
  error: null,
};
const meta = {
  version: "2.0.0",
  releaseNotes: "",
  releaseDate: "",
  size: 0,
  releaseUrl: "https://github.com/SPlayer-Dev/SPlayer-Next/releases/tag/v2.0.0",
};
let event!: (event: UpdateEvent) => void;
let api: {
  getState: ReturnType<typeof vi.fn>;
  check: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
  openDownloadPage: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  setActivePinia(createPinia());
  api = {
    getState: vi.fn().mockResolvedValue(initial),
    check: vi.fn().mockResolvedValue(initial),
    download: vi.fn().mockResolvedValue(initial),
    install: vi.fn().mockResolvedValue(initial),
    openDownloadPage: vi.fn(),
  };
  Object.assign(window, {
    api: {
      update: {
        ...api,
        onEvent: (callback: typeof event) => {
          event = callback;
          return vi.fn();
        },
      },
    },
  });
});

describe("更新快照与用户入口", () => {
  it("主进程未接受下载时界面不提前显示下载中", async () => {
    const { useUpdateStore } = await import("./update");
    const store = useUpdateStore();
    await flushPromises();
    event({
      state: { ...initial, revision: 2, phase: "available", meta },
      notification: "available",
    });
    api.download.mockResolvedValue({ ...initial, revision: 2, phase: "available", meta });
    store.download();
    expect(store.phase).toBe("available");
    await flushPromises();
    expect(store.phase).toBe("available");
  });
  it("窗口恢复已下载快照，不重新检查且可以打开安装弹窗", async () => {
    api.getState.mockResolvedValue({ ...initial, phase: "downloaded", percent: 100, meta });
    const { useUpdateStore } = await import("./update");
    const store = useUpdateStore();
    await flushPromises();
    expect(api.check).not.toHaveBeenCalled();
    store.checkManually();
    expect(store.dialogOpen).toBe(true);
    expect(store.phase).toBe("downloaded");
  });
  it("迟到快照不能覆盖新事件，通道切换清除旧弹窗", async () => {
    let finish!: (state: UpdateState) => void;
    api.getState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { useUpdateStore } = await import("./update");
    const store = useUpdateStore();
    event({
      state: { ...initial, revision: 5, phase: "available", meta },
      notification: "available",
    });
    finish({ ...initial, revision: 2 });
    await flushPromises();
    expect(store.phase).toBe("available");
    expect(api.check).not.toHaveBeenCalled();
    event({ state: { ...initial, revision: 6, channel: "beta", phase: "cancelling" } });
    expect(store.meta).toBeNull();
    expect(store.hasUpdate).toBe(false);
    expect(store.dialogOpen).toBe(false);
  });
  it("安装失败的有效包仍可从关于页打开重试", async () => {
    api.getState.mockResolvedValue({
      ...initial,
      phase: "error",
      meta,
      error: { source: "install", message: "failed" },
    });
    const { useUpdateStore } = await import("./update");
    const store = useUpdateStore();
    await flushPromises();
    store.checkManually();
    expect(store.dialogOpen).toBe(true);
    expect(api.check).not.toHaveBeenCalled();
    store.install();
    expect(api.install).toHaveBeenCalledOnce();
  });
  it("下载失败后统一入口重新检查，不再打开旧目标", async () => {
    api.getState.mockResolvedValue({
      ...initial,
      phase: "error",
      meta,
      error: { source: "download", message: "removed" },
    });
    const { useUpdateStore } = await import("./update");
    const store = useUpdateStore();
    await flushPromises();
    store.checkManually();
    expect(api.check).toHaveBeenCalledWith(true);
    expect(store.dialogOpen).toBe(false);
    expect(api.download).not.toHaveBeenCalled();
  });

  it("商店版统一入口直接打开商店", async () => {
    api.getState.mockResolvedValue({ ...initial, mode: "store" });
    const { useUpdateStore } = await import("./update");
    const store = useUpdateStore();
    await flushPromises();
    api.check.mockClear();
    store.checkManually();
    expect(api.openDownloadPage).toHaveBeenCalledOnce();
    expect(api.check).not.toHaveBeenCalled();
  });
});
