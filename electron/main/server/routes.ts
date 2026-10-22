/**
 * 外部 API REST 路由
 * 控制路由：POST，状态查询：GET
 */

import { Hono } from "hono";
import { app as electronApp } from "electron";
import { ZodError } from "zod/v4";
import * as nowPlaying from "@main/services/nowPlaying";
import { playerControl } from "@main/services/playerControl";
import { getWsClientCount } from "./broadcast";

/**
 * 注册 HTTP 查询与控制入口，业务操作复用主进程服务
 * @returns 外部 API 路由
 */
export const buildRoutes = (): Hono => {
  const api = new Hono();

  api.get("/info", (c) =>
    c.json({
      name: electronApp.getName(),
      version: electronApp.getVersion(),
      wsClients: getWsClientCount(),
    }),
  );

  api.get("/status", (c) => {
    const status = playerControl.getStatus();
    return c.json({
      state: status.state,
      position: status.positionMs,
      duration: status.durationMs,
      volume: status.volume,
      isFinished: status.isFinished,
      currentIndex: status.currentIndex,
    });
  });

  api.get("/queue", async (c) => {
    const offset = c.req.query("offset");
    const limit = c.req.query("limit");
    try {
      return c.json(
        await playerControl.getQueue({
          offset: offset === undefined ? undefined : Number(offset),
          limit: limit === undefined ? undefined : Number(limit),
        }),
      );
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        error instanceof ZodError ? 400 : 500,
      );
    }
  });

  api.get("/volume", (c) => c.json({ volume: playerControl.getStatus().volume }));

  api.get("/now-playing", (c) => c.json(nowPlaying.lightSnapshot()));

  api.get("/lyrics", (c) => c.json(nowPlaying.lyricSnapshot()));

  api.post("/play", (c) => {
    playerControl.play();
    return c.json({ ok: true });
  });

  api.post("/pause", (c) => {
    playerControl.pause();
    return c.json({ ok: true });
  });

  api.post("/stop", (c) => {
    playerControl.stop();
    return c.json({ ok: true });
  });

  api.post("/seek", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { positionMs?: number } | null;
    const positionMs = Number(body?.positionMs);
    if (!Number.isFinite(positionMs) || positionMs < 0) {
      return c.json({ error: "positionMs (number, >=0) required" }, 400);
    }
    try {
      await playerControl.seek(positionMs);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
    return c.json({ ok: true });
  });

  api.post("/volume", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { volume?: number } | null;
    const volume = Number(body?.volume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
      return c.json({ error: "volume (number, 0..1) required" }, 400);
    }
    playerControl.setVolume(volume);
    return c.json({ ok: true });
  });

  api.post("/next", (c) => {
    playerControl.next();
    return c.json({ ok: true });
  });
  api.post("/prev", (c) => {
    playerControl.prev();
    return c.json({ ok: true });
  });

  return api;
};
