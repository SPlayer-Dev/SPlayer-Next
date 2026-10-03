import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { test } from "node:test";
import { centerActions, startCentering } from "./niri-island-center.mjs";

const window = (x, width, extra = {}) => ({
  id: 7,
  app_id: "top.imsyy.splayer_next",
  title: "Dynamic Island",
  is_floating: true,
  workspace_id: 1,
  layout: {
    tile_pos_in_workspace_view: [x, 80],
    window_size: [width, 60],
    window_offset_in_tile: [0, 0],
  },
  ...extra,
});
const workspaces = [{ id: 1, output: "DP-1" }];
const outputs = { "DP-1": { logical: { width: 2560, x: 0, y: 0, scale: 1 } } };
const delta = (w, ws = workspaces, os = outputs) =>
  centerActions([w], ws, os).reduce(
    (sum, action) => sum + action.Action.MoveFloatingWindow.x.AdjustFixed,
    0,
  );

test("长短歌词按真实窗口宽度回到同一中心，保留纵向位置并指定窗口 ID", () => {
  for (const width of [255, 711, 415, 1010, 400, 255]) {
    const w = window(1025, width);
    const actions = centerActions([w], workspaces, outputs);
    for (const {
      Action: { MoveFloatingWindow: action },
    } of actions) {
      assert.equal(action.id, 7);
      assert.deepEqual(action.y, { AdjustFixed: 0 });
      assert.ok(Math.abs(action.x.AdjustFixed) <= 10);
    }
    assert.ok(Math.abs(1025 + delta(w) + width / 2 - 1280) <= 0.5);
  }
});

test("对已居中窗口和奇数宽度不重复发命令", () => {
  assert.equal(delta(window(1080, 400)), 0);
  assert.equal(delta(window(1080, 401)), 0);
});

test("多屏、负坐标和分数缩放使用窗口所属输出的逻辑宽度", () => {
  const ws = [
    { id: 1, output: "left" },
    { id: 2, output: "right" },
  ];
  const os = {
    left: { logical: { x: -1920, y: 0, width: 1536, scale: 1.25 } },
    right: { logical: { x: 0, y: 0, width: 1920, scale: 2 } },
  };
  assert.equal(delta(window(500, 400), ws, os), 68);
  assert.equal(delta(window(500, 400, { workspace_id: 2 }), ws, os), 260);
});

test("边框偏移计入内容中心", () => {
  const w = window(1080, 400);
  w.layout.window_offset_in_tile = [4, 4];
  assert.equal(delta(w), -4);
});

test("不触碰主窗口、同名的其他应用或平铺窗口", () => {
  for (const extra of [
    { title: "SPlayer-Next" },
    { app_id: "another-player" },
    { is_floating: false },
  ])
    assert.equal(delta(window(100, 400, extra)), 0);
});

test("旧版 IPC、不可见布局和拔掉的显示器安全跳过", () => {
  assert.equal(delta(window(100, 400, { layout: undefined })), 0);
  const w = window(100, 400);
  w.layout.tile_pos_in_workspace_view = null;
  assert.equal(delta(w), 0);
  assert.equal(delta(window(100, 400), workspaces, {}), 0);
  assert.equal(delta(window(100, 400), workspaces, { "DP-1": { logical: null } }), 0);
});

test("缺少 Niri 会话时不建立连接", async () => {
  await assert.rejects(startCentering(""), /NIRI_SOCKET/);
});

async function withNiri(t, handler) {
  const dir = await mkdtemp(join(tmpdir(), "splayer-niri-"));
  const socketPath = join(dir, "ipc.sock");
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    createInterface({ input: socket }).on("line", (line) => handler(JSON.parse(line), socket));
  });
  server.listen(socketPath);
  await once(server, "listening");
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return socketPath;
}

test("快速连续换行合并请求，修正事件不形成循环，停止时断开连接", { timeout: 5000 }, async (t) => {
  let current = window(1025, 255);
  let stream;
  let releaseWindows;
  const actions = [];
  let done;
  const centered = new Promise((resolve) => {
    done = resolve;
  });
  const path = await withNiri(t, (request, socket) => {
    if (request === "EventStream") {
      stream = socket;
      socket.write(`${JSON.stringify({ Ok: "Handled" })}\n`);
      socket.write(`${JSON.stringify({ WindowsChanged: { windows: [current] } })}\n`);
    } else if (request === "Windows") {
      if (!releaseWindows) {
        releaseWindows = () => socket.write(`${JSON.stringify({ Ok: { Windows: [current] } })}\n`);
        current = window(1025, 711);
        stream.write(
          `${JSON.stringify({ WindowLayoutsChanged: { changes: [[7, current.layout]] } })}\n`,
        );
        releaseWindows();
      } else socket.write(`${JSON.stringify({ Ok: { Windows: [current] } })}\n`);
    } else if (request === "Workspaces") {
      socket.write(`${JSON.stringify({ Ok: { Workspaces: workspaces } })}\n`);
    } else if (request === "Outputs") {
      socket.write(`${JSON.stringify({ Ok: { Outputs: outputs } })}\n`);
    } else if (request.Action) {
      actions.push(request.Action.MoveFloatingWindow);
      current.layout.tile_pos_in_workspace_view[0] +=
        request.Action.MoveFloatingWindow.x.AdjustFixed;
      socket.write(`${JSON.stringify({ Ok: "Handled" })}\n`);
      stream.write(
        `${JSON.stringify({ WindowLayoutsChanged: { changes: [[7, current.layout]] } })}\n`,
      );
      if (
        Math.abs(
          current.layout.tile_pos_in_workspace_view[0] + current.layout.window_size[0] / 2 - 1280,
        ) <= 0.5
      )
        done();
    }
  });
  const controller = await startCentering(path);
  t.after(controller.stop);
  await centered;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(actions.length, 10);
  assert.equal(
    actions.reduce((sum, action) => sum + action.x.AdjustFixed, 0),
    -100,
  );
  controller.stop();
  await controller.closed;
});

test("不支持的 IPC 返回错误时停止，不持续发送失败命令", { timeout: 5000 }, async (t) => {
  let requests = 0;
  const path = await withNiri(t, (request, socket) => {
    requests++;
    if (request === "EventStream") {
      socket.write(`${JSON.stringify({ Err: "unsupported request" })}\n`);
    }
  });
  const controller = await startCentering(path);
  await assert.rejects(controller.closed, /unsupported request/);
  assert.equal(requests, 1);
});
