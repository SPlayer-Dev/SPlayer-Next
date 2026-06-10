/**
 * 外部 API REST 路由
 * 控制路由：POST，状态查询：GET
 */

import { Hono } from "hono";
import { app as electronApp } from "electron";
import { getPlayer } from "@main/services/engine";
import { sendToMain } from "@main/utils/broadcast";
import { toMs } from "@main/utils/time";
import * as nowPlaying from "@main/services/nowPlaying";
import { getWsClientCount } from "./broadcast";

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
    const raw = getPlayer().getStatus();
    return c.json({
      state: raw.state,
      position: toMs(raw.position),
      duration: toMs(raw.duration),
      volume: raw.volume,
      isFinished: raw.isFinished,
    });
  });

  api.get("/volume", (c) => c.json({ volume: getPlayer().getVolume() }));

  // 当前播放完整快照
  api.get("/now-playing", (c) => c.json(nowPlaying.snapshot()));

  api.post("/play", async (c) => {
    await getPlayer().play();
    return c.json({ ok: true });
  });

  api.post("/pause", (c) => {
    getPlayer().pause();
    return c.json({ ok: true });
  });

  api.post("/stop", (c) => {
    getPlayer().stop();
    return c.json({ ok: true });
  });

  api.post("/seek", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { positionMs?: number } | null;
    const positionMs = Number(body?.positionMs);
    if (!Number.isFinite(positionMs) || positionMs < 0) {
      return c.json({ error: "positionMs (number, >=0) required" }, 400);
    }
    await getPlayer().seek(positionMs / 1000);
    return c.json({ ok: true });
  });

  api.post("/volume", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { volume?: number } | null;
    const volume = Number(body?.volume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
      return c.json({ error: "volume (number, 0..1) required" }, 400);
    }
    getPlayer().setVolume(volume);
    return c.json({ ok: true });
  });

  api.post("/next", (c) => {
    sendToMain("player:event", { type: "next" });
    return c.json({ ok: true });
  });
  api.post("/prev", (c) => {
    sendToMain("player:event", { type: "prev" });
    return c.json({ ok: true });
  });

  return api;
};
