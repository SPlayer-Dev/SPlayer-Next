/* eslint-disable @typescript-eslint/explicit-function-return-type -- CommonJS 测试通过 JSDoc 声明类型。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { AudioPlayer } = require(process.env.SPLAYER_AUDIO_ENGINE_MODULE || "../audio-engine.node");

/**
 * 创建无需外部音源的静音 WAV，避免测试依赖网络服务。
 * @param {string} directory - 临时目录
 * @returns {string} WAV 路径
 */
function createFixture(directory) {
  const sampleRate = 96000;
  const dataSize = sampleRate * 2 * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF");
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  const file = path.join(directory, "silence.wav");
  fs.writeFileSync(file, wav);
  return file;
}

/**
 * 超时作为取消失效的失败条件，不参与加载时序控制。
 * @param {Promise} promise - 待验证的异步操作
 * @returns {Promise} 原操作结果
 */
async function within(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("音频加载未在 10 秒内结束")), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

for (const action of ["stop", "replace"]) {
  test(`挂起 HTTP 加载后 ${action} 不提交过期音源`, { timeout: 30000 }, async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-load-race-"));
    const fixture = createFixture(directory);
    const sockets = new Set();
    let requestArrived;
    const received = new Promise((resolve) => {
      requestArrived = resolve;
    });
    // 等实际请求进入服务端后再取消，确保竞争发生在 Rust 加载任务启动之后。
    const server = http.createServer(() => requestArrived());
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    let player;
    t.after(async () => {
      player?.stop();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(directory, { recursive: true, force: true });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    player = new AudioPlayer();
    const pending = player.load(`http://127.0.0.1:${server.address().port}/slow.wav`, false).then(
      () => ({ success: true }),
      (error) => ({ error }),
    );
    await within(received);
    if (action === "stop") {
      player.stop();
    } else {
      const metadata = await within(player.load(fixture, false));
      assert.equal(metadata.originalSampleRate, 96000);
      assert.equal(player.getStatus().state, "paused");
    }
    const result = await within(pending);
    assert.ok(result.error, "过期加载必须被拒绝");
    assert.match(result.error.message, /^\[Cancelled\]/);
    assert.equal(player.getStatus().state, action === "stop" ? "stopped" : "paused");
    if (action === "replace") assert.ok(Math.abs(player.getDuration() - 1) < 0.01);
  });
}
