#!/usr/bin/env node
import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const APP_ID = "top.imsyy.splayer_next";
const TITLE = "Dynamic Island";

/** 只匹配灵动岛浮动窗口，避免移动同一应用的主窗口。 */
export const isIsland = (window) =>
  window.app_id === APP_ID && window.title === TITLE && window.is_floating;

/** 使用合成器的逻辑坐标居中，保留纵向位置，不混用 Electron 的缩放坐标。 */
export function centerActions(windows, workspaces, outputs) {
  const actions = [];
  for (const window of windows) {
    if (!isIsland(window)) continue;
    const layout = window.layout;
    const position = layout?.tile_pos_in_workspace_view;
    const width = layout?.window_size?.[0];
    const offset = layout?.window_offset_in_tile?.[0];
    const workspace = workspaces.find((item) => item.id === window.workspace_id);
    const outputWidth = outputs[workspace?.output]?.logical?.width;
    // 旧版 IPC 缺少布局信息，或显示器正在拔插时不尝试定位。
    if (![position?.[0], width, offset, outputWidth].every(Number.isFinite)) continue;
    if (width <= 0 || outputWidth <= 0) continue;
    const delta = outputWidth / 2 - (position[0] + offset + width / 2);
    // 容许整数坐标取整，避免奇数宽度或分数缩放导致反复移动。
    if (Math.abs(delta) < 1) continue;
    // Niri 26.04 对不超过 10 个逻辑像素的移动不运行动画。
    // 同一 IPC 连接内连续发送小步位移，避免一次大幅回正产生第二层弹簧动画。
    let remaining = Math.round(delta);
    while (remaining !== 0) {
      const step = Math.sign(remaining) * Math.min(10, Math.abs(remaining));
      actions.push({
        Action: {
          MoveFloatingWindow: {
            id: window.id,
            x: { AdjustFixed: step },
            y: { AdjustFixed: 0 },
          },
        },
      });
      remaining -= step;
    }
  }
  return actions;
}

/** 一个连接顺序读写请求，另一个连接订阅事件，不启动轮询或子进程。 */
export async function startCentering(socketPath = process.env.NIRI_SOCKET) {
  if (!socketPath)
    throw new Error("NIRI_SOCKET is not set; run this helper inside a Niri session.");
  const sockets = [];
  const readers = [];
  let stopped = false;
  let dirty = false;
  let running = false;
  let targets = new Set();
  let resolveClosed;
  let rejectClosed;
  const closed = new Promise((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  // 初始化尚未返回控制器时，也要处理连接失败。
  closed.catch(() => {});

  const stop = (error) => {
    if (stopped) return;
    stopped = true;
    for (const reader of readers) reader.close();
    for (const socket of sockets) socket.destroy();
    if (error) rejectClosed(error);
    else resolveClosed();
  };

  const connect = async () => {
    const socket = createConnection(socketPath);
    sockets.push(socket);
    socket.on("error", stop);
    socket.on("close", () => stop());
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const reader = createInterface({ input: socket, crlfDelay: Infinity });
    readers.push(reader);
    return { socket, lines: reader[Symbol.asyncIterator]() };
  };

  try {
    const commands = await connect();
    const request = async (message) => {
      commands.socket.write(`${JSON.stringify(message)}\n`);
      const line = await commands.lines.next();
      if (line.done) throw new Error("Niri IPC connection closed.");
      const reply = JSON.parse(line.value);
      if (reply.Err !== undefined) throw new Error(`Niri IPC: ${reply.Err}`);
      return reply.Ok;
    };

    const reconcile = async () => {
      if (running || stopped) return;
      running = true;
      try {
        while (dirty && !stopped) {
          dirty = false;
          const { Windows: windows } = await request("Windows");
          targets = new Set(windows.filter(isIsland).map((window) => window.id));
          if (!targets.size) continue;
          const { Workspaces: workspaces } = await request("Workspaces");
          const { Outputs: outputs } = await request("Outputs");
          for (const action of centerActions(windows, workspaces, outputs)) {
            if (stopped) break;
            await request(action);
          }
        }
      } catch (error) {
        if (!stopped) stop(error);
      } finally {
        running = false;
      }
    };

    const events = await connect();
    events.socket.write('"EventStream"\n');
    const consume = async () => {
      try {
        for await (const line of events.lines) {
          if (stopped) break;
          const event = JSON.parse(line);
          if (event.Err !== undefined) throw new Error(`Niri IPC: ${event.Err}`);
          if (
            event.WindowsChanged ||
            event.WorkspacesChanged ||
            (event.WindowOpenedOrChanged &&
              (isIsland(event.WindowOpenedOrChanged.window) ||
                targets.has(event.WindowOpenedOrChanged.window.id))) ||
            (event.WindowClosed && targets.has(event.WindowClosed.id)) ||
            event.WindowLayoutsChanged?.changes.some(([id]) => targets.has(id))
          ) {
            dirty = true;
            void reconcile();
          }
        }
        stop();
      } catch (error) {
        if (!stopped) stop(error);
      }
    };
    void consume();
    return { stop: () => stop(), closed };
  } catch (error) {
    stop(error);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const controller = await startCentering();
    process.once("SIGINT", controller.stop);
    process.once("SIGTERM", controller.stop);
    console.log("SPlayer Dynamic Island centering active for this Niri session.");
    await controller.closed;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
