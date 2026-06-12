/**
 * WebSocket 入口：双向通道
 *
 * Server → Client：
 *   - 连接建立：`{ kind: "hello", clients: N }`
 *   - player 事件：`{ kind: "event", type, data }`（由 wsBroadcast 推）
 *   - 命令 ack：`{ kind: "ack", op }` / `{ kind: "error", op, error }`
 *
 * Client → Server：`{ op: "play" | "pause" | "stop" | "next" | "prev" | "seek" | "setVolume", ... }`
 */

import type { WSContext } from "hono/ws";
import { getPlayer } from "@main/services/engine";
import { sendToMain } from "@main/utils/broadcast";
import { serverLog } from "@main/utils/logger";
import { addWsClient, removeWsClient, getWsClientCount } from "./broadcast";

interface ClientMessage {
  op: string;
  positionMs?: number;
  volume?: number;
}

const ack = (ws: WSContext, op: string): void => {
  ws.send(JSON.stringify({ kind: "ack", op }));
};

const fail = (ws: WSContext, op: string, error: string): void => {
  ws.send(JSON.stringify({ kind: "error", op, error }));
};

const dispatchCommand = async (ws: WSContext, msg: ClientMessage): Promise<void> => {
  try {
    switch (msg.op) {
      case "play":
        await getPlayer().play();
        return ack(ws, msg.op);
      case "pause":
        getPlayer().pause();
        return ack(ws, msg.op);
      case "stop":
        getPlayer().stop();
        return ack(ws, msg.op);
      case "next":
        sendToMain("player:event", { type: "next" });
        return ack(ws, msg.op);
      case "prev":
        sendToMain("player:event", { type: "prev" });
        return ack(ws, msg.op);
      case "seek": {
        const positionMs = Number(msg.positionMs);
        if (!Number.isFinite(positionMs) || positionMs < 0) {
          return fail(ws, msg.op, "positionMs (number, >=0) required");
        }
        await getPlayer().seek(positionMs / 1000);
        return ack(ws, msg.op);
      }
      case "setVolume": {
        const volume = Number(msg.volume);
        if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
          return fail(ws, msg.op, "volume (number, 0..1) required");
        }
        getPlayer().setVolume(volume);
        return ack(ws, msg.op);
      }
      default:
        return fail(ws, msg.op ?? "?", "unknown op");
    }
  } catch (err) {
    fail(ws, msg.op ?? "?", err instanceof Error ? err.message : String(err));
  }
};

export const wsHandlers = {
  onOpen(_evt: Event, ws: WSContext) {
    addWsClient(ws);
    ws.send(JSON.stringify({ kind: "hello", clients: getWsClientCount() }));
  },
  async onMessage(evt: MessageEvent, ws: WSContext) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof evt.data === "string" ? evt.data : evt.data.toString());
    } catch {
      return fail(ws, "?", "invalid json");
    }
    await dispatchCommand(ws, msg);
  },
  onClose(_evt: CloseEvent, ws: WSContext) {
    removeWsClient(ws);
  },
  onError(_evt: Event, ws: WSContext) {
    serverLog.warn("WS 客户端错误");
    removeWsClient(ws);
  },
};
