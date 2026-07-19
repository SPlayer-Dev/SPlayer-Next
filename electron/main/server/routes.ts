/**
 * 外部 API REST 路由
 * 控制路由：POST，状态查询：GET
 */

import { Hono } from "hono";
import { app as electronApp } from "electron";
import { getPlayer } from "@main/services/engine";
import { toMs } from "@main/utils/time";
import * as nowPlaying from "@main/services/nowPlaying";
import { playerControl } from "@main/services/playerControl";
import { getWsClientCount } from "./broadcast";
import { importRecommendations } from "@main/ipc/recommendations";
import type { RecommendationImportRequest } from "@shared/types/recommendation";

const MAX_RECOMMENDATION_ITEMS = 50;

const isImportRequest = (value: unknown): value is RecommendationImportRequest => {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<RecommendationImportRequest>;
  if (request.provider !== "youtube-music") return false;
  if (request.mode !== "playlist" && request.mode !== "append" && request.mode !== "replace") return false;
  if (
    !Array.isArray(request.items) ||
    request.items.length === 0 ||
    request.items.length > MAX_RECOMMENDATION_ITEMS
  ) {
    return false;
  }
  return request.items.every((item) => {
    if (!item || typeof item !== "object") return false;
    return (
      typeof item.sourceId === "string" &&
      item.sourceId.length > 0 &&
      typeof item.title === "string" &&
      item.title.trim().length > 0 &&
      Array.isArray(item.artists) &&
      item.artists.every((artist) => typeof artist === "string") &&
      (item.album === undefined || typeof item.album === "string") &&
      (item.durationMs === undefined ||
        (typeof item.durationMs === "number" &&
          Number.isFinite(item.durationMs) &&
          item.durationMs >= 0))
    );
  });
};

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

  api.post("/recommendations/import", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isImportRequest(body)) {
      return c.json({ error: "invalid recommendation import request" }, 400);
    }
    try {
      return c.json(await importRecommendations(body));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
    }
  });

  return api;
};
