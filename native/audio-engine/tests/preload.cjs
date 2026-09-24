/* eslint-disable @typescript-eslint/explicit-function-return-type -- Node.js 原生集成测试 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const http = require("node:http");
const { AudioPlayer } = require(process.env.SPLAYER_AUDIO_ENGINE_MODULE || "../audio-engine.node");

test("长静音尾部提前交接但保留原始媒体时长", { timeout: 10000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-tail-transition-"));
  const current = path.join(directory, "current.wav");
  const next = path.join(directory, "next.wav");
  writeWav(current, 96000, 20, 0.1);
  const data = fs.readFileSync(current);
  data.fill(0, 44 + 96000 * 4 * 5);
  fs.writeFileSync(current, data);
  writeWav(next, 48000, 10, 0.1);
  const player = new AudioPlayer();
  t.after(() => {
    player.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await player.load(current, true);
  const began = performance.now();
  const end = await player.analyzeTail(0, 20);
  t.diagnostic(`96 kHz 双声道曲尾分析耗时：${Math.round(performance.now() - began)}ms`);
  assert.ok(Math.abs(end - 5.25) < 0.02, `${end}`);
  assert.equal(player.getDuration(), 20);
  await player.prepareNext("tail", next);
  const result = await player.transitionToPrepared(
    "tail",
    next,
    end - player.getPosition(),
    "eager",
    undefined,
    end,
  );
  assert.ok(result);
  assert.equal(player.getDuration(), 10);
  assert.ok(player.getPosition() > 0);
});

test("网络曲目交叉到本地曲目时安全释放旧解码器", { timeout: 20000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-transition-http-"));
  const current = path.join(directory, "current.wav");
  const next = path.join(directory, "next.wav");
  writeWav(current, 48000, 3, 0.2);
  writeWav(next, 48000, 6, 0.1);
  const audio = fs.readFileSync(current);
  const server = http.createServer((request, response) => {
    const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    response.writeHead(range ? 206 : 200, {
      "Content-Type": "audio/wav",
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${audio.length}` } : {}),
    });
    response.end(audio.subarray(start, end + 1));
  });
  const player = new AudioPlayer();
  t.after(async () => {
    player.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const source = `http://127.0.0.1:${server.address().port}/current.wav`;
  for (let round = 0; round < 3; round++) {
    await player.load(source, true);
    if (round === 1) await player.seek(0.2);
    if (round === 2) await player.reinitOutput();
    assert.equal(await player.prepareNext(`http-${round}`, next), true);
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const result = await player.transitionToPrepared(`http-${round}`, next, 1.4, "eager");
    assert.ok(result);
    assert.equal(player.getDuration(), 6);
    assert.ok(player.getPosition() > 0);
    player.stop();
  }
});

/**
 * 生成可精确核对时长的双声道静音 WAV
 * @param {string} file - 测试音频的写入路径
 * @param {number} sampleRate - 采样率，单位为 Hz
 * @param {number} seconds - 音频时长，单位为秒
 * @param {number} amplitude - 固定样本幅度，零表示静音
 */
function writeWav(file, sampleRate, seconds, amplitude = 0) {
  const size = sampleRate * seconds * 4;
  const data = Buffer.alloc(44 + size);
  data.write("RIFF");
  data.writeUInt32LE(36 + size, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 4, 28);
  data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(size, 40);
  if (amplitude !== 0) {
    const sample = Math.round(amplitude * 32767);
    for (let offset = 44; offset < data.length; offset += 2) data.writeInt16LE(sample, offset);
  }
  fs.writeFileSync(file, data);
}

test("交叉过渡遵守下一曲 CUE 边界并拒绝过短片段", { timeout: 15000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-transition-cue-"));
  const current = path.join(directory, "current.wav");
  const next = path.join(directory, "next.wav");
  const player = new AudioPlayer();
  t.after(() => {
    player.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  writeWav(current, 48000, 6, 0.2);
  writeWav(next, 44100, 10, 0.1);
  await player.load(current, true);
  await player.prepareNext("short", next, 2);
  assert.equal(await player.transitionToPrepared("short", next, 2, "eager", 2.5), null);
  assert.equal(player.getStatus().state, "playing");
  await player.prepareNext("cue", next, 2);
  assert.ok(await player.transitionToPrepared("cue", next, 1.2, "eager", 5));
  assert.ok(player.getPosition() >= 3 && player.getPosition() < 4);
  await new Promise((resolve) => setTimeout(resolve, 2200));
  assert.ok(Math.abs(player.getPosition() - 5) < 0.05, "不能播放到 CUE 子曲目之外");
  assert.equal(player.getStatus().isFinished, true);
});

for (const exclusive of [false, true]) {
  test(
    `同一输出流完成交叉过渡（${exclusive ? "独占" : "共享"}输出）`,
    { skip: exclusive && process.env.SPLAYER_TEST_EXCLUSIVE !== "1", timeout: 30000 },
    async (t) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-transition-"));
      const current = path.join(directory, "current.wav");
      const next = path.join(directory, "next.wav");
      const player = new AudioPlayer();
      t.after(() => {
        player.stop();
        fs.rmSync(directory, { recursive: true, force: true });
      });
      if (exclusive) await player.setExclusiveMode(true);
      writeWav(current, 48000, 5);
      writeWav(next, 44100, 6, 0.1);
      await player.load(current, true);
      assert.equal(await player.prepareNext("transition", next), true);
      const result = await player.transitionToPrepared("transition", next, 4, "standard");
      assert.ok(result, "应在当前输出流中提交下一曲");
      assert.equal(result.duration, 6);
      assert.equal(player.getStatus().state, "playing");
      assert.equal(player.getDuration(), 6);
      assert.ok(player.getPosition() > 0, "交叉过渡期间下一曲应推进位置");
    },
  );
}

test("停止播放会取消尚未完成的交叉过渡", { timeout: 30000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-transition-stop-"));
  const current = path.join(directory, "current.wav");
  const next = path.join(directory, "next.wav");
  const player = new AudioPlayer();
  t.after(() => {
    player.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  writeWav(current, 48000, 8);
  writeWav(next, 48000, 8, 0.1);
  await player.load(current, true);
  assert.equal(await player.prepareNext("cancelled-transition", next), true);
  const pending = player.transitionToPrepared("cancelled-transition", next, 6, "standard");
  await new Promise((resolve) => setTimeout(resolve, 100));
  player.stop();
  assert.equal(await pending, null);
});

for (const exclusive of [false, true]) {
  test(
    `混音开始后手动切歌取消旧交接（${exclusive ? "独占" : "共享"}输出）`,
    { skip: exclusive && process.env.SPLAYER_TEST_EXCLUSIVE !== "1", timeout: 30000 },
    async (t) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-transition-replace-"));
      const current = path.join(directory, "current.wav");
      const prepared = path.join(directory, "prepared.wav");
      const selected = path.join(directory, "selected.wav");
      const player = new AudioPlayer();
      t.after(() => {
        player.stop();
        fs.rmSync(directory, { recursive: true, force: true });
      });
      if (exclusive) await player.setExclusiveMode(true);
      writeWav(current, 48000, 6);
      writeWav(prepared, 48000, 6, 0.1);
      writeWav(selected, 48000, 7, 0.2);
      await player.load(current, true);
      assert.equal(await player.prepareNext("old-candidate", prepared), true);
      const pending = player.transitionToPrepared("old-candidate", prepared, 3, "standard");
      await new Promise((resolve) => setTimeout(resolve, 900));
      assert.ok(player.getPosition() > 0.35, "当前曲必须已进入交叉过渡窗口");
      await player.load(selected, true);
      assert.equal(await pending, null);
      assert.equal(player.getDuration(), 7);
    },
  );
}

for (const exclusive of [false, true]) {
  test(
    `双槽位预载与复用（${exclusive ? "独占" : "共享"}输出）`,
    {
      skip: exclusive && process.env.SPLAYER_TEST_EXCLUSIVE !== "1",
      timeout: 30000,
    },
    async (t) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-preload-"));
      const current = path.join(directory, "current.wav");
      const next = path.join(directory, "next.wav");
      const player = new AudioPlayer();
      t.after(() => {
        player.stop();
        fs.rmSync(directory, { recursive: true, force: true });
      });
      if (exclusive) await player.setExclusiveMode(true);
      writeWav(current, 48000, 8);
      const initial = await player.load(current, false);
      writeWav(next, initial.sampleRate, 6);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(await player.prepareNext("next", next), true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(player.getStatus().state, "paused");
      assert.equal(player.getPosition(), 0);
      assert.equal(player.getDuration(), 8);
      const loaded = await player.load(next, false, "next");
      assert.equal(loaded.preparedPosition, 0, "必须复用已解码 PCM，而不是重新打开文件");
      assert.equal(player.getDuration(), 6);
      assert.equal(player.getPosition(), 0, "后台预载不得推进播放位置");

      await player.prepareNext("cue", next, 2);
      const cue = await player.load(next, false, "cue");
      assert.equal(cue.preparedPosition, 2);
      assert.equal(player.getPosition(), 2);

      const superseded = player.prepareNext("superseded", next);
      const latest = player.prepareNext("latest", next);
      assert.equal(await superseded, false);
      assert.equal(await latest, true);
      assert.equal((await player.load(next, false, "latest")).preparedPosition, 0);

      const pending = player.prepareNext("immediate-stop", next);
      player.stop();
      assert.equal(await pending, false);
      await player.load(next, false);

      await player.prepareNext("old", next);
      await player.prepareNext("new", next);
      player.cancelPrepared("old");
      assert.equal((await player.load(next, false, "new")).preparedPosition, 0);

      await player.prepareNext("cancelled", next);
      player.cancelPrepared("cancelled");
      assert.equal((await player.load(next, false, "cancelled")).preparedPosition, undefined);

      await player.prepareNext("dsp", next);
      player.setSpeed(1.25);
      assert.equal(
        (await player.load(next, false, "dsp")).preparedPosition,
        undefined,
        "音效参数改变后不能使用旧 PCM",
      );
      player.setSpeed(1);

      await player.prepareNext("stopped", next);
      player.stop();
      assert.equal((await player.load(next, false, "stopped")).preparedPosition, undefined);

      await player.play();
      const before = player.getPosition();
      await player.prepareNext("while-playing", next);
      await new Promise((resolve) => setTimeout(resolve, 180));
      assert.equal(player.getStatus().state, "playing");
      assert.ok(player.getPosition() > before, "准备下一曲时当前歌曲应继续播放");
      player.cancelPrepared("while-playing");
    },
  );
}

test("拒绝未经缓存的远端源及无效起点", async () => {
  const player = new AudioPlayer();
  assert.throws(() => player.prepareNext("remote", "https://example.invalid/song.flac"), /缓存/);
  assert.throws(() => player.prepareNext("invalid", "unused.wav", -1), /起点/);
  player.stop();
});

test("未打开设备时也能预载，立即取消及连续替换按调用顺序生效", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-preload-cancel-"));
  const source = path.join(directory, "audio.wav");
  writeWav(source, 48000, 2);
  const player = new AudioPlayer();
  t.after(async () => {
    player.stop();
    await new Promise((resolve) => setTimeout(resolve, 30));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const stopped = player.prepareNext("stop", source);
  player.stop();
  assert.equal(await stopped, false);
  const cancelled = player.prepareNext("cancel", source);
  player.cancelPrepared("cancel");
  assert.equal(await cancelled, false);
  const first = player.prepareNext("first", source);
  const second = player.prepareNext("second", source);
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(player.getDuration(), 0);
  assert.equal(player.getPosition(), 0);
  assert.equal(player.getStatus().state, "stopped");
});
