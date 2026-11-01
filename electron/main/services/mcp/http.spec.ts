import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: false,
  loadServer: vi.fn(),
  createEndpoint: vi.fn(),
  closeEndpoint: vi.fn(),
  serve: vi.fn(),
  closeServer: vi.fn(),
}));

vi.mock("@main/store", () => ({
  store: {
    get: (key: string) => {
      if (key === "mcp.enabled") return mocks.enabled;
      if (key === "mcp.port") return 8123;
      return "test-key";
    },
  },
}));
vi.mock("@main/utils/broadcast", () => ({ broadcast: vi.fn() }));
vi.mock("@main/utils/logger", () => ({
  serverLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@hono/node-server", () => ({ serve: mocks.serve }));
vi.mock("./server", () => {
  mocks.loadServer();
  return { createMcpEndpoint: mocks.createEndpoint };
});

describe("MCP 延迟启动", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.enabled = false;
    mocks.closeEndpoint.mockResolvedValue(undefined);
    mocks.createEndpoint.mockReturnValue({ close: mocks.closeEndpoint, handle: vi.fn() });
    mocks.closeServer.mockImplementation((callback: () => void) => callback());
    mocks.serve.mockImplementation(() => {
      const server = Object.assign(new EventEmitter(), { close: mocks.closeServer });
      queueMicrotask(() => server.emit("listening"));
      return server;
    });
  });

  it("功能关闭时，读取状态和启动均不加载端点依赖", async () => {
    const service = await import("./http");
    expect(service.getMcpStatus().listening).toBe(false);
    await service.startMcpServer();
    expect(mocks.loadServer).not.toHaveBeenCalled();
    expect(mocks.serve).not.toHaveBeenCalled();
  });

  it("并发启动复用同一任务，停止释放服务和端点", async () => {
    const service = await import("./http");
    mocks.enabled = true;
    const first = service.startMcpServer();
    expect(service.startMcpServer()).toBe(first);
    expect((await first).listening).toBe(true);
    await service.stopMcpServer();
    expect(mocks.createEndpoint).toHaveBeenCalledOnce();
    expect(mocks.serve).toHaveBeenCalledOnce();
    expect(mocks.closeServer).toHaveBeenCalledOnce();
    expect(mocks.closeEndpoint).toHaveBeenCalledOnce();
    expect(service.getMcpStatus().listening).toBe(false);
  });

  it("加载期间停止，不在关闭后创建服务", async () => {
    const service = await import("./http");
    mocks.enabled = true;
    const starting = service.startMcpServer();
    await service.stopMcpServer();
    expect((await starting).listening).toBe(false);
    expect(mocks.serve).not.toHaveBeenCalled();
  });

  it("加载期间关闭后重新启用，以最后一次请求为准", async () => {
    const service = await import("./http");
    mocks.enabled = true;
    const starting = service.startMcpServer();
    const stopped = service.stopMcpServer();
    const restarted = service.startMcpServer();
    await Promise.all([starting, stopped, restarted]);
    expect(service.getMcpStatus().listening).toBe(true);
    expect(mocks.serve).toHaveBeenCalledOnce();
    await service.stopMcpServer();
  });

  it("依赖加载期间关闭功能，完成后不监听端口", async () => {
    const service = await import("./http");
    mocks.enabled = true;
    const starting = service.startMcpServer();
    mocks.enabled = false;
    expect((await starting).listening).toBe(false);
    expect(mocks.serve).not.toHaveBeenCalled();
  });

  it("端点初始化失败时返回状态，允许重新启动", async () => {
    const service = await import("./http");
    mocks.enabled = true;
    mocks.createEndpoint.mockImplementationOnce(() => {
      throw new Error("endpoint failed");
    });
    expect((await service.startMcpServer()).error?.message).toContain("endpoint failed");
    expect((await service.startMcpServer()).listening).toBe(true);
    await service.stopMcpServer();
  });
});
