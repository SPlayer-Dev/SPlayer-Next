/**
 * WS 客户端注册表 + 事件广播
 *
 * 仅负责"推给外部 WS 客户端"这一件事；
 * 给渲染端的推送由调用方各自 sendToMain，两条路径独立。
 */

import { serverLog } from "@main/utils/logger";
import type { WSContext } from "hono/ws";

/** 当前在线的 WS 客户端 */
const wsClients = new Set<WSContext>();

/** 高频事件名单：默认不向外部 WS 推送（避免带宽爆炸） */
const HIGH_FREQ_EVENTS = new Set(["fftData", "position"]);

export const addWsClient = (ws: WSContext): void => {
  wsClients.add(ws);
  serverLog.info(`WS 客户端已连接，当前在线 ${wsClients.size}`);
};

export const removeWsClient = (ws: WSContext): void => {
  if (wsClients.delete(ws)) {
    serverLog.info(`WS 客户端已断开，当前在线 ${wsClients.size}`);
  }
};

export const getWsClientCount = (): number => wsClients.size;

/**
 * 推送一条 player 事件给所有外部 WS 客户端
 * @param event - 事件对象 `{ type, data? }`
 */
export const wsBroadcast = (event: { type: string; data?: unknown }): void => {
  if (wsClients.size === 0) return;
  if (HIGH_FREQ_EVENTS.has(event.type)) return;
  const payload = JSON.stringify({ kind: "event", ...event });
  for (const ws of wsClients) {
    try {
      ws.send(payload);
    } catch (err) {
      // 发送失败的多半已经断开但 onClose/onError 未触发；主动清理避免反复抛错
      serverLog.warn("WS 推送失败，移除失效客户端", err);
      removeWsClient(ws);
    }
  }
};
