import path from "node:path";
import { app as electronApp, session } from "electron";
import type { Hono } from "hono";
import type { WSContext } from "hono/ws";
import { serveStatic } from "@hono/node-server/serve-static";
import { getPlayer } from "@main/services/engine";
import { fftSubscriptions } from "@main/services/fft";
import { encodeSpectrum } from "@main/services/fftSubscriptions";
import * as nowPlaying from "@main/services/nowPlaying";
import { MAIN_PARTITION } from "@main/utils/protocol";
import { toMs } from "@main/utils/time";
import type { RemoteDisplayPosition, RemoteDisplaySnapshot } from "@shared/types/remoteDisplay";
import type { PlayerState } from "@shared/types/player";
import { externalControlGate } from "./gate";

const subscriptions = new Map<WSContext, () => void>();

/** 用引擎实时位置建立锚点，避免把陈旧快照的时间当成当前时间。 */
export const displayPosition = (): RemoteDisplayPosition => {
  const light = nowPlaying.lightSnapshot();
  const raw = getPlayer().getStatus();
  return {
    trackId: light.track?.id ?? null,
    position: toMs(raw.position),
    duration: toMs(raw.duration),
    playing: raw.state === "playing",
    state: raw.state as PlayerState,
    speed: light.speed,
    volume: raw.volume,
    sendTimestamp: Date.now(),
  };
};

export const displaySnapshot = (): RemoteDisplaySnapshot => ({
  ...nowPlaying.snapshot(),
  ...displayPosition(),
});

/** 客户端隐藏、关闭或发送失败时释放监听，避免无用的高频推送。 */
export const unsubscribeDisplay = (ws: WSContext): void => {
  subscriptions.get(ws)?.();
  subscriptions.delete(ws);
};

export const subscribeDisplay = (ws: WSContext, spectrum = false): void => {
  unsubscribeDisplay(ws);
  const send = (kind: string, data: unknown): void => {
    try {
      if (ws.readyState !== 1) {
        unsubscribeDisplay(ws);
        return;
      }
      ws.send(JSON.stringify({ kind, data }));
    } catch {
      unsubscribeDisplay(ws);
    }
  };
  const off = [
    nowPlaying.onLyricChange(() => send("display-snapshot", displaySnapshot())),
    nowPlaying.onPositionSync(() => send("display-position", displayPosition())),
    nowPlaying.onLyricOffsetChange((data) => send("display-offset", data)),
  ];
  if (spectrum) {
    off.push(
      fftSubscriptions.subscribe((data) => {
        try {
          if (ws.readyState !== 1) return unsubscribeDisplay(ws);
          ws.send(encodeSpectrum(data));
        } catch {
          unsubscribeDisplay(ws);
        }
      }),
    );
  }
  subscriptions.set(ws, () => off.forEach((fn) => fn()));
  send("display-snapshot", displaySnapshot());
};

export const closeDisplaySubscriptions = (): void => {
  for (const ws of subscriptions.keys()) unsubscribeDisplay(ws);
};

/** 只代理当前歌曲的封面，不接受任意文件路径或远程 URL。 */
export const installDisplayRoutes = (app: Hono): void => {
  app.get("/api/display/snapshot", (c) => c.json(displaySnapshot()));
  app.get("/api/display/cover", async (c) => {
    const track = nowPlaying.lightSnapshot().track;
    if (!track || c.req.query("trackId") !== track.id) return c.body(null, 404);
    const url =
      c.req.query("size") === "thumbnail"
        ? track.cover || track.coverOriginal
        : track.coverOriginal || track.cover;
    if (!url || !/^(https?:|cache:|streaming-cover:)/.test(url)) return c.body(null, 404);
    try {
      const result = await session
        .fromPartition(MAIN_PARTITION)
        .fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!result.ok) return c.body(null, 502);
      const type = result.headers.get("content-type") ?? "image/jpeg";
      if (!type.startsWith("image/")) return c.body(null, 415);
      return new Response(result.body, {
        headers: {
          "Content-Type": type,
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return c.body(null, 502);
    }
  });
  const root = electronApp.isPackaged
    ? path.join(process.resourcesPath, "remote-display")
    : path.join(electronApp.getAppPath(), "remote-display/dist");
  app.get("/display", externalControlGate, (c) => c.redirect("/display/"));
  app.use(
    "/display/*",
    externalControlGate,
    serveStatic({
      root,
      rewriteRequestPath: (requestPath) =>
        requestPath === "/display/" ? "/index.html" : requestPath.replace(/^\/display\//, "/"),
    }),
  );
};
