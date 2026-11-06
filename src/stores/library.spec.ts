import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ErrorCode } from "@shared/types/errors";

const mocks = vi.hoisted(() => ({
  addScanDir: vi.fn(),
  removeScanDir: vi.fn(),
}));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  Object.assign(window, {
    api: {
      library: {
        addScanDir: mocks.addScanDir,
        removeScanDir: mocks.removeScanDir,
      },
    },
  });
});

describe("曲库扫描目录", () => {
  it("添加成功时同步到本地列表且不触发移除", async () => {
    mocks.addScanDir.mockResolvedValue({ success: true, data: "C:/music" });
    const { useLibraryStore } = await import("./library");
    const store = useLibraryStore();
    const res = await store.addScanDir();
    expect(res.success).toBe(true);
    expect(store.scanDirs).toContain("C:/music");
    expect(mocks.removeScanDir).not.toHaveBeenCalled();
  });

  it("嵌套目录被主进程拒绝时列表不变且不调用移除", async () => {
    mocks.addScanDir.mockResolvedValue({
      success: false,
      error: ErrorCode.SCAN_DIR_NESTED,
    });
    const { useLibraryStore } = await import("./library");
    const store = useLibraryStore();
    store.scanDirs = ["C:/music"];
    const res = await store.addScanDir();
    expect(res.success).toBe(false);
    expect(res.error).toBe(ErrorCode.SCAN_DIR_NESTED);
    expect(store.scanDirs).toEqual(["C:/music"]);
    expect(mocks.removeScanDir).not.toHaveBeenCalled();
  });
});
