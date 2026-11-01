// @vitest-environment node
import { once } from "node:events";
import { createConnection, type AddressInfo, type Socket } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ server: null as Server | null }));
vi.mock("@main/store", () => ({
  store: {
    get: (key: string) => {
      if (key === "mcp.enabled") return true;
      if (key === "mcp.port") return 0;
      return "test-key";
    },
  },
}));
vi.mock("@main/utils/broadcast", () => ({ broadcast: vi.fn() }));
vi.mock("@main/utils/logger", () => ({
  serverLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@hono/node-server", async (original) => {
  const adapter = await original<typeof import("@hono/node-server")>();
  return {
    ...adapter,
    serve: (...args: Parameters<typeof adapter.serve>) => {
      runtime.server = adapter.serve(...args) as Server;
      return runtime.server;
    },
  };
});
vi.mock("./server", async () => {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { createMcpEndpoint } = await import("./endpoint");
  return {
    createMcpEndpoint: () =>
      createMcpEndpoint(() => new McpServer({ name: "shutdown-test", version: "1.0.0" })),
  };
});

let service: typeof import("./http");
let client: Socket | undefined;
let stopping: Promise<void> | undefined;

beforeEach(async () => {
  vi.resetModules();
  runtime.server = null;
  client = undefined;
  stopping = undefined;
  service = await import("./http");
  await service.startMcpServer();
});

afterEach(async () => {
  client?.destroy();
  runtime.server?.closeAllConnections();
  await stopping;
  await service.stopMcpServer();
});

describe("MCP 真实连接退出", () => {
  it.each([
    { name: "空闲连接", request: "" },
    { name: "未完成的请求头", request: "POST /mcp HTTP/1.1\r\nHost: localhost\r\n" },
    {
      name: "未完成的请求体",
      request:
        'POST /mcp HTTP/1.1\r\nHost: localhost\r\nx-mcp-key: test-key\r\nContent-Type: application/json\r\nContent-Length: 1024\r\n\r\n{"jsonrpc":',
    },
  ])("立即断开$name，不等待客户端超时", async ({ request }) => {
    const address = runtime.server!.address() as AddressInfo;
    const accepted = once(runtime.server!, "connection");
    client = createConnection({ host: "127.0.0.1", port: address.port });
    await Promise.all([once(client, "connect"), accepted]);
    let connectionError: NodeJS.ErrnoException | undefined;
    client.once("error", (error: NodeJS.ErrnoException) => {
      connectionError = error;
    });
    const closed = new Promise<void>((resolve) => client!.once("close", () => resolve()));
    if (request) client.write(request);

    stopping = service.stopMcpServer();

    await expect.poll(() => client!.destroyed, { timeout: 1000 }).toBe(true);
    await closed;
    await stopping;
    expect([undefined, "ECONNRESET"]).toContain(connectionError?.code);
    expect(service.getMcpStatus().listening).toBe(false);
  });
});
