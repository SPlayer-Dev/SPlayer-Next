import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { UpdateEvent, UpdateMeta } from "@shared/types/update";
import { toast } from "@/composables/useToast";
import { useUpdateStore } from "./update";

const mockMetaA: UpdateMeta = {
  version: "1.0.0",
  releaseNotes: "Initial release",
  releaseDate: "2026-01-01T00:00:00.000Z",
  size: 50_000_000,
};

const mockMetaB: UpdateMeta = {
  version: "2.0.0",
  releaseNotes: "Major release",
  releaseDate: "2026-02-01T00:00:00.000Z",
  size: 60_000_000,
};

describe("useUpdateStore", () => {
  let eventHandler: (event: UpdateEvent) => void;
  const mockApi = {
    check: vi.fn(),
    download: vi.fn(),
    install: vi.fn(),
    openDownloadPage: vi.fn(),
    onEvent: vi.fn((cb: (event: UpdateEvent) => void) => {
      eventHandler = cb;
      return () => {};
    }),
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    window.api = {
      update: mockApi as unknown as typeof window.api.update,
    } as unknown as typeof window.api;
    vi.spyOn(toast, "warning").mockImplementation(() => ({ id: 1, close: vi.fn() }));
    vi.spyOn(toast, "success").mockImplementation(() => ({ id: 1, close: vi.fn() }));
    vi.spyOn(toast, "error").mockImplementation(() => ({ id: 1, close: vi.fn() }));
  });

  it("初始状态应为 idle 且无可用更新", () => {
    const store = useUpdateStore();
    expect(store.phase).toBe("idle");
    expect(store.meta).toBeNull();
    expect(store.percent).toBe(0);
    expect(store.canInstall).toBe(false);
    expect(store.errorSource).toBeNull();
    expect(store.hasUpdate).toBe(false);
    expect(mockApi.check).toHaveBeenCalledWith(false);
  });

  it("invalidated 应立即清除元数据、进度、安装资格、错误来源并重置阶段与弹窗", () => {
    const store = useUpdateStore();
    eventHandler({
      type: "available",
      meta: mockMetaA,
      manual: false,
      canInstall: true,
    });
    eventHandler({ type: "progress", percent: 45 });
    expect(store.phase).toBe("downloading");
    expect(store.meta).toEqual(mockMetaA);
    expect(store.percent).toBe(45);
    expect(store.canInstall).toBe(true);

    eventHandler({ type: "invalidated" });

    expect(store.phase).toBe("idle");
    expect(store.meta).toBeNull();
    expect(store.percent).toBe(0);
    expect(store.canInstall).toBe(false);
    expect(store.errorSource).toBeNull();
    expect(store.dialogOpen).toBe(false);
    expect(store.hasUpdate).toBe(false);
  });

  it("download() 不得乐观变更阶段为 downloading 且不预先清除 errorSource", () => {
    const store = useUpdateStore();
    eventHandler({
      type: "available",
      meta: mockMetaA,
      manual: false,
      canInstall: true,
    });
    expect(store.phase).toBe("available");

    store.download();

    // 移除乐观下载后，阶段依然停留在 available
    expect(store.phase).toBe("available");
    expect(store.percent).toBe(0);
    expect(mockApi.download).toHaveBeenCalledTimes(1);
  });

  it("主进程确认后派发 downloading 事件才进入下载中状态并清理 errorSource", () => {
    const store = useUpdateStore();
    eventHandler({
      type: "available",
      meta: mockMetaA,
      manual: false,
      canInstall: true,
    });

    eventHandler({ type: "downloading" });
    expect(store.phase).toBe("downloading");
    expect(store.percent).toBe(0);
    expect(store.errorSource).toBeNull();
  });

  it("notAvailable 应清除残留的旧 meta、安装资格与错误状态", () => {
    const store = useUpdateStore();
    eventHandler({
      type: "available",
      meta: mockMetaA,
      manual: false,
      canInstall: true,
    });
    expect(store.meta).not.toBeNull();

    eventHandler({ type: "notAvailable", manual: true });
    expect(store.phase).toBe("upToDate");
    expect(store.meta).toBeNull();
    expect(store.percent).toBe(0);
    expect(store.canInstall).toBe(false);
    expect(store.errorSource).toBeNull();
    expect(store.hasUpdate).toBe(false);
    expect(toast.success).toHaveBeenCalled();
  });

  it("有效 checking 必须清空旧 meta/percent/canInstall/errorSource 并进入 checking", () => {
    const store = useUpdateStore();

    // 先前有可用更新
    eventHandler({
      type: "available",
      meta: mockMetaA,
      manual: false,
      canInstall: true,
    });
    expect(store.meta).toEqual(mockMetaA);

    // 新的 checking 事件到来
    eventHandler({ type: "checking" });
    expect(store.phase).toBe("checking");
    expect(store.meta).toBeNull();
    expect(store.percent).toBe(0);
    expect(store.canInstall).toBe(false);
    expect(store.errorSource).toBeNull();

    // 从 error 状态进入 checking
    eventHandler({
      type: "error",
      message: "失败",
      manual: false,
      source: "check",
    });
    expect(store.phase).toBe("error");

    eventHandler({ type: "checking" });
    expect(store.phase).toBe("checking");
    expect(store.errorSource).toBeNull();
  });

  it("checking 不得意外冲掉进行中的下载或已完成的安装状态", () => {
    const store = useUpdateStore();

    // 1. 下载中状态
    eventHandler({
      type: "available",
      meta: mockMetaA,
      manual: false,
      canInstall: true,
    });
    eventHandler({ type: "progress", percent: 60 });
    expect(store.phase).toBe("downloading");

    // 同通道后台检查触发 checking，不冲刷 downloading
    eventHandler({ type: "checking" });
    expect(store.phase).toBe("downloading");
    expect(store.percent).toBe(60);

    // 2. 已就绪状态
    eventHandler({ type: "downloaded", meta: mockMetaA });
    expect(store.phase).toBe("downloaded");

    // 同通道后台检查触发 checking，不冲刷 downloaded
    eventHandler({ type: "checking" });
    expect(store.phase).toBe("downloaded");
    expect(store.meta).toEqual(mockMetaA);
  });

  it("downloadRejected (busy / checking / unavailable) 不改变 phase 与 meta，仅提示对应原因", () => {
    const store = useUpdateStore();
    eventHandler({
      type: "available",
      meta: mockMetaB,
      manual: false,
      canInstall: true,
    });

    // 忙碌拒绝
    eventHandler({ type: "downloadRejected", reason: "busy" });
    expect(store.phase).toBe("available");
    expect(store.meta).toEqual(mockMetaB);
    expect(toast.warning).toHaveBeenCalled();

    // 检查中拒绝
    eventHandler({ type: "downloadRejected", reason: "checking" });
    expect(store.phase).toBe("available");
    expect(store.meta).toEqual(mockMetaB);
    expect(toast.warning).toHaveBeenCalledTimes(2);

    // 不可用拒绝
    eventHandler({ type: "downloadRejected", reason: "unavailable" });
    expect(store.phase).toBe("available");
    expect(store.meta).toEqual(mockMetaB);
    expect(toast.warning).toHaveBeenCalledTimes(3);
  });

  it("检查失败即使先前存在旧 meta 也必须重试检查，而不是推测为重试下载", () => {
    const store = useUpdateStore();
    // 假设在错误前曾有 meta
    eventHandler({
      type: "available",
      meta: mockMetaA,
      manual: false,
      canInstall: true,
    });

    // 收到检查失败事件
    eventHandler({
      type: "error",
      message: "检查失败",
      manual: true,
      source: "check",
    });
    expect(store.phase).toBe("error");
    expect(store.errorSource).toBe("check");

    // 调用 retry() 必须走 checkManually，而不是下载
    store.retry();
    expect(mockApi.check).toHaveBeenCalledWith(true);
    expect(mockApi.download).not.toHaveBeenCalled();
    expect(store.phase).toBe("checking");
    expect(store.meta).toBeNull();
  });

  it("错误 -> 重试被拒绝 (rejected) -> 再次重试保持重试下载", () => {
    const store = useUpdateStore();
    eventHandler({
      type: "available",
      meta: mockMetaA,
      manual: false,
      canInstall: true,
    });

    // 1. 下载失败
    eventHandler({
      type: "error",
      message: "下载中断",
      manual: true,
      source: "download",
    });
    expect(store.phase).toBe("error");
    expect(store.errorSource).toBe("download");

    // 2. 第一次点击重试
    store.retry();
    expect(mockApi.download).toHaveBeenCalledTimes(1);
    // download() 未被主进程接受前，不得清除 errorSource，phase 保持 error
    expect(store.phase).toBe("error");
    expect(store.errorSource).toBe("download");

    // 3. 主进程拒绝下载请求（例如底层检查正在结算）
    eventHandler({ type: "downloadRejected", reason: "checking" });
    expect(store.phase).toBe("error");
    expect(store.errorSource).toBe("download");
    expect(toast.warning).toHaveBeenCalled();

    // 4. 用户再次点击重试，仍应派发 download 而不是错误退化为 check
    store.retry();
    expect(mockApi.download).toHaveBeenCalledTimes(2);
    expect(mockApi.check).not.toHaveBeenCalledWith(true);

    // 5. 主进程接受并派发 downloading，此时才转移 phase 并清除 errorSource
    eventHandler({ type: "downloading" });
    expect(store.phase).toBe("downloading");
    expect(store.errorSource).toBeNull();
  });

  it("安装失败时不得盲目重试下载，应重试安装", () => {
    const store = useUpdateStore();
    eventHandler({
      type: "available",
      meta: mockMetaA,
      manual: false,
      canInstall: true,
    });
    eventHandler({ type: "downloaded", meta: mockMetaA });
    expect(store.phase).toBe("downloaded");

    eventHandler({
      type: "error",
      message: "安装失败",
      manual: true,
      source: "install",
    });
    expect(store.phase).toBe("error");
    expect(store.errorSource).toBe("install");

    store.retry();
    // 不应重试下载
    expect(mockApi.download).not.toHaveBeenCalled();
    // 应重试安装
    expect(mockApi.install).toHaveBeenCalledTimes(1);
  });

  it("安装失败且弹窗关闭后，手动检查应重新打开弹窗供重试安装，而不发起主进程检查", () => {
    const store = useUpdateStore();
    eventHandler({
      type: "available",
      meta: mockMetaA,
      manual: false,
      canInstall: true,
    });
    eventHandler({ type: "downloaded", meta: mockMetaA });
    eventHandler({
      type: "error",
      message: "安装失败",
      manual: true,
      source: "install",
    });

    expect(store.phase).toBe("error");
    expect(store.errorSource).toBe("install");
    expect(store.meta).toEqual(mockMetaA);
    expect(store.canInstall).toBe(true);

    // 用户关闭弹窗
    store.dialogOpen = false;
    mockApi.check.mockClear();

    // 在设置页或顶栏点击检查更新触发 checkManually
    store.checkManually();

    // 弹窗重新打开
    expect(store.dialogOpen).toBe(true);
    // 状态未被破坏
    expect(store.phase).toBe("error");
    expect(store.errorSource).toBe("install");
    expect(store.meta).toEqual(mockMetaA);
    expect(store.canInstall).toBe(true);
    // 未发起新的主进程检查
    expect(mockApi.check).not.toHaveBeenCalled();

    // 点击重试依然能够触发安装重试
    store.retry();
    expect(mockApi.install).toHaveBeenCalledTimes(1);
    expect(mockApi.download).not.toHaveBeenCalled();
  });
});
