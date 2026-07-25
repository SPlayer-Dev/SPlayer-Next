/**
 * 网易云音乐 API（neteasecloudmusicapi-enhanced）路由
 *
 * 将 @neteasecloudmusicapienhanced/api 的所有接口暴露为 HTTP 端点：
 *   GET/POST /api/netease/:name/*
 *
 * 与 SPlayer 的 Fastify 实现等价，但使用 Hono 适配现有服务器架构。
 */

import { Hono } from "hono";
import { pathCase } from "change-case";
import NeteaseCloudMusicApi from "@neteasecloudmusicapienhanced/api";
import { serverLog } from "@main/utils/logger";

/** server.js 的导出（serveNcmApi、getModulesDefinitions 等），需从动态路由中排除 */
const NON_API_EXPORTS = new Set<string>([
  ...Object.keys((NeteaseCloudMusicApi as Record<string, unknown>).server ?? {}),
  "server",
]);

/** 预热 xeapi 配置 */
void NeteaseCloudMusicApi.register_anonimous?.({}).catch(() => {
  // 静默忽略预热失败，首次请求会重试
});

export const buildNeteaseRoutes = (): Hono => {
  const app = new Hono();

  /** 主信息 */
  app.get("/", (c) =>
    c.json({
      name: "@neteasecloudmusicapienhanced/api",
      description: "网易云音乐 API Enhanced",
      author: "@MoeFurina",
      license: "MIT",
      url: "https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced",
    }),
  );

  /** 动态路由处理函数 */
  const dynamicHandler = async (c: any) => {
    const requestPath = c.req.param("*") as string;
    if (!requestPath) return c.json({ error: "missing api name" }, 400);

    const routerName = Object.keys(NeteaseCloudMusicApi).find((key) => {
      if (NON_API_EXPORTS.has(key)) return false;
      if (typeof (NeteaseCloudMusicApi as Record<string, unknown>)[key] !== "function")
        return false;
      return pathCase(key) === requestPath || key === requestPath;
    });

    if (!routerName) {
      return c.json({ error: "API not found" }, 404);
    }

    const neteaseApi = (
      NeteaseCloudMusicApi as unknown as Record<string, (params: unknown) => Promise<any>>
    )[routerName];

    const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
    let body: Record<string, unknown> = {};
    try {
      body = await c.req.json().catch(() => ({}));
    } catch {
      // form-urlencoded or empty — 忽略
    }

    const params = { ...query, ...body, cookie: c.req.raw.headers.get("Cookie") || undefined };

    serverLog.log(`Request NcmAPI: ${requestPath}`);

    try {
      const result = await neteaseApi(params);
      return c.json(result?.body ?? result);
    } catch (error: unknown) {
      serverLog.error(`NcmAPI Error: ${requestPath}`, error);
      if (error && typeof error === "object" && "status" in error) {
        const err = error as { status: number; body: unknown };
        return c.json(err.body ?? { error: String(err.status) }, err.status);
      }
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  };

  /** 通配符路由 */
  app.get("/:path(*)", dynamicHandler);
  app.post("/:path(*)", dynamicHandler);

  return app;
};
