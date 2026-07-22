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
import { requestExternalPlaylist } from "@main/ipc/externalPlaylists";
import type { RecommendationImportRequest } from "@shared/types/recommendation";

const MAX_RECOMMENDATION_ITEMS = 500;

const isImportRequest = (
  value: unknown,
  allowEmptyItems = false,
): value is RecommendationImportRequest => {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<RecommendationImportRequest>;
  if (request.provider !== "youtube-music") return false;
  if (request.mode !== "playlist" && request.mode !== "append" && request.mode !== "replace")
    return false;
  if (
    !Array.isArray(request.items) ||
    (!allowEmptyItems && request.items.length === 0) ||
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
          item.durationMs >= 0)) &&
      (item.neteaseId === undefined ||
        (typeof item.neteaseId === "string" &&
          item.neteaseId.length > 0 &&
          item.neteaseId.length <= 30))
    );
  });
};

const getText = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= maxLength ? text : undefined;
};

const getPlaylistId = (value: string): string | undefined =>
  value.startsWith("pl_") && value.length <= 100 ? value : undefined;

const getCoverUrl = (value: unknown): string | undefined => {
  const url = getText(value, 2_000);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
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

  api.get("/playlists", async (c) => {
    try {
      return c.json(await requestExternalPlaylist({ operation: "list" }));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
    }
  });

  api.get("/playlists/:id", async (c) => {
    const playlistId = getPlaylistId(c.req.param("id"));
    if (!playlistId) return c.json({ error: "invalid playlist id" }, 400);
    try {
      const result = await requestExternalPlaylist({ operation: "get", playlistId });
      return result.found === false ? c.json({ error: "playlist not found" }, 404) : c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
    }
  });

  api.post("/playlists", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const title = getText(body?.title, 200);
    if (!title) return c.json({ error: "title (non-empty string, <=200) required" }, 400);
    const description =
      body?.description === undefined ? undefined : getText(body.description, 2_000);
    const cover = body?.cover === undefined ? undefined : getCoverUrl(body.cover);
    if (body?.description !== undefined && description === undefined) {
      return c.json({ error: "description (non-empty string, <=2000) required" }, 400);
    }
    if (body?.cover !== undefined && cover === undefined) {
      return c.json({ error: "cover (http(s) URL, <=2000) required" }, 400);
    }
    try {
      return c.json(
        await requestExternalPlaylist({ operation: "create", title, description, cover }),
        201,
      );
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
    }
  });

  api.patch("/playlists/:id", async (c) => {
    const playlistId = getPlaylistId(c.req.param("id"));
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!playlistId) return c.json({ error: "invalid playlist id" }, 400);
    const title = body?.title === undefined ? undefined : getText(body.title, 200);
    const description =
      body?.description === null
        ? null
        : body?.description === undefined
          ? undefined
          : getText(body.description, 2_000);
    const cover =
      body?.cover === null ? null : body?.cover === undefined ? undefined : getCoverUrl(body.cover);
    if (
      (title === undefined && description === undefined && cover === undefined) ||
      (body?.title !== undefined && title === undefined) ||
      (body?.description !== undefined && description === undefined) ||
      (body?.cover !== undefined && cover === undefined)
    ) {
      return c.json({ error: "title, description, or cover required" }, 400);
    }
    try {
      const result = await requestExternalPlaylist({
        operation: "update",
        playlistId,
        title,
        description,
        cover,
      });
      return result.found === false ? c.json({ error: "playlist not found" }, 404) : c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
    }
  });

  api.delete("/playlists/:id", async (c) => {
    const playlistId = getPlaylistId(c.req.param("id"));
    if (!playlistId) return c.json({ error: "invalid playlist id" }, 400);
    try {
      const result = await requestExternalPlaylist({ operation: "remove", playlistId });
      return result.found === false
        ? c.json({ error: "playlist not found" }, 404)
        : c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
    }
  });

  api.put("/playlists/:id/tracks", async (c) => {
    const playlistId = getPlaylistId(c.req.param("id"));
    const body = (await c.req
      .json()
      .catch(() => null)) as Partial<RecommendationImportRequest> | null;
    const request = { ...(body ?? {}), mode: "playlist" };
    if (!playlistId || !isImportRequest(request)) {
      return c.json({ error: "invalid playlist track replacement request" }, 400);
    }
    try {
      const result = await requestExternalPlaylist({
        operation: "replaceTracks",
        playlistId,
        items: request.items,
      });
      return result.found === false ? c.json({ error: "playlist not found" }, 404) : c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
    }
  });

  api.patch("/playlists/:id/tracks", async (c) => {
    const playlistId = getPlaylistId(c.req.param("id"));
    const body = (await c.req.json().catch(() => null)) as
      (Partial<RecommendationImportRequest> & { removeTrackIds?: unknown }) | null;
    const request = { ...(body ?? {}), mode: "playlist" };
    const removeTrackIds = body?.removeTrackIds;
    if (
      !playlistId ||
      !isImportRequest(request, true) ||
      !Array.isArray(removeTrackIds) ||
      !removeTrackIds.every((id) => typeof id === "string" && id.length > 0)
    ) {
      return c.json({ error: "invalid playlist track patch request" }, 400);
    }
    try {
      const result = await requestExternalPlaylist({
        operation: "patchTracks",
        playlistId,
        items: request.items,
        removeTrackIds,
      });
      return result.found === false ? c.json({ error: "playlist not found" }, 404) : c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
    }
  });

  return api;
};
