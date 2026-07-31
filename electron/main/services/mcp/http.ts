import type { Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { store } from "@main/store";
import { broadcast } from "@main/utils/broadcast";
import { serverLog } from "@main/utils/logger";
import type { McpClientConfigParams, McpStatus } from "@shared/types/settings";
import { createMcpEndpoint, type McpEndpoint } from "./server";

let runningServer: Server | null = null;
let runningEndpoint: McpEndpoint | null = null;
let runningPort: number | null = null;
let lastError: { code: string; message: string } | null = null;

export const getMcpStatus = (): McpStatus => ({
  listening: runningServer !== null,
  port: runningPort,
  error: lastError,
});

/** 向渲染进程同步 MCP 服务状态 */
const publishStatus = (): void => broadcast("mcp:status", getMcpStatus());

/** 获取持久化的本机连接密钥，首次使用时生成 */
const getAccessKey = (): string => {
  const current = store.get("mcp.accessKey");
  if (current) return current;
  const generated = randomBytes(16).toString("hex");
  store.set("mcp.accessKey", generated);
  return generated;
};

/** 获取生成 AI 客户端配置所需的动态参数 */
export const getMcpClientConfigParams = (): McpClientConfigParams => ({
  port: runningPort ?? store.get("mcp.port"),
  accessKey: getAccessKey(),
});

/** 使用恒定时间比较连接密钥 */
const hasValidAccessKey = (candidate: string | undefined): boolean => {
  if (!candidate) return false;
  const expected = Buffer.from(getAccessKey());
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
};

/** 校验浏览器来源，防止本地 MCP 端点遭受 DNS rebinding */
const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
};

/** 启动仅监听本机的 MCP 服务 */
export const startMcpServer = (): Promise<McpStatus> => {
  return new Promise((resolve) => {
    if (runningServer || !store.get("mcp.enabled")) {
      resolve(getMcpStatus());
      return;
    }

    const port = store.get("mcp.port");
    const endpoint = createMcpEndpoint();
    const app = new Hono();
    app.all("/mcp", async (c) => {
      if (!store.get("mcp.enabled")) return c.json({ error: "MCP disabled" }, 403);
      if (!hasValidAccessKey(c.req.header("x-mcp-key"))) {
        return c.json({ error: "invalid MCP key" }, 401);
      }
      if (!isAllowedOrigin(c.req.header("origin"))) {
        return c.json({ error: "invalid Origin" }, 403);
      }
      return endpoint.handle(c.req.raw);
    });
    app.get("/", (c) => c.text("SPlayer Next MCP server"));

    let settled = false;
    const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }) as Server;
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      lastError = { code: error.code ?? "UNKNOWN", message: error.message };
      publishStatus();
      serverLog.error(`MCP 服务监听 ${port} 失败 (${lastError.code}): ${lastError.message}`);
      void endpoint.close();
      try {
        server.close();
      } catch {}
      resolve(getMcpStatus());
    });
    server.once("listening", () => {
      if (settled) return;
      settled = true;
      runningServer = server;
      runningEndpoint = endpoint;
      runningPort = port;
      lastError = null;
      publishStatus();
      serverLog.info(`MCP 服务已启动: http://127.0.0.1:${port}/mcp`);
      resolve(getMcpStatus());
    });
  });
};

/** 停止 MCP 服务并释放全部会话 */
export const stopMcpServer = async (): Promise<void> => {
  if (!runningServer) return;
  const server = runningServer;
  const endpoint = runningEndpoint;
  runningServer = null;
  runningEndpoint = null;
  runningPort = null;
  publishStatus();
  const serverClosed = new Promise<void>((resolve) => {
    server.close((error) => {
      if (error) serverLog.warn("MCP 服务关闭异常:", error);
      else serverLog.info("MCP 服务已关闭");
      resolve();
    });
  });
  await Promise.all([serverClosed, endpoint?.close()]);
};

/** 配置变更后重启 MCP 服务 */
export const restartMcpServer = async (): Promise<McpStatus> => {
  await stopMcpServer();
  return startMcpServer();
};
