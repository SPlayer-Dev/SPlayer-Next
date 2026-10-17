import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const root = new URL("../vendor/amll-core/", import.meta.url);
function spring(file) {
  const src = readFileSync(new URL(file, root), "utf8");
  const start = src.indexOf("var Spring = class"),
    end = src.indexOf("//#endregion", start);
  return runInNewContext(src.slice(start, end) + ";Spring", {
    Duration: { ZERO: 0, asSecsF64: (v) => v / 1000 },
    getVelocity: (f) => (t) => (f(t + 0.00001) - f(t)) / 0.00001,
  });
}
const Original = spring("upstream.mjs"),
  Optimized = spring("amll-core.mjs");
test("弹簧优化保留移动、延迟、反向跳转与直接定位轨迹", () => {
  const a = new Original(0),
    b = new Optimized(0);
  for (let i = 0; i < 5000; i++) {
    if (i === 100 || i === 400 || i === 900 || i === 1500) {
      a.setTargetPosition(i % 3 ? 800 : -300, i % 2 ? 200 : 0);
      b.setTargetPosition(i % 3 ? 800 : -300, i % 2 ? 200 : 0);
    }
    if (i === 550) {
      a.setPosition(123);
      b.setPosition(123);
    }
    if (i === 2000) {
      a.updateParams({ damping: 18, mass: 2 });
      b.updateParams({ damping: 18, mass: 2 });
    }
    a.update(16);
    b.update(16);
    assert.ok(Math.abs(a.getCurrentPosition() - b.getCurrentPosition()) < 1e-7, `frame ${i}`);
  }
  assert.equal(b.arrived(), true);
  const solver = b.currentSolver;
  b.update(16);
  assert.equal(b.currentSolver, solver);
});
test("延迟参数消费一次后释放队列，弹簧最终停下", () => {
  const b = new Optimized(0);
  b.setTargetPosition(500);
  b.updateParams({ damping: 18 }, 100);
  for (let i = 0; i < 2000; i++) b.update(16);
  assert.equal(b.queueParams, undefined);
  assert.equal(b.arrived(), true);
  assert.equal(b.getCurrentPosition(), 500);
});

import { sampleMask } from "../vendor/amll-core/mask-runtime.mjs";
test("遮罩取样保持逐词停顿、注音、倒退跳转与零长度边界", () => {
  const frames = [
    { offset: 0, position: -100 },
    { offset: 0.2, position: -100 },
    { offset: 0.4, position: -50 },
    { offset: 0.4, position: -45 },
    { offset: 0.7, position: 0 },
    { offset: 1, position: 0 },
  ];
  assert.equal(sampleMask(frames, 0.1), -100);
  assert.equal(sampleMask(frames, 0.3), -75);
  assert.equal(sampleMask(frames, 0.4), -45);
  assert.ok(Math.abs(sampleMask(frames, 0.55) + 22.5) < 1e-9);
  assert.equal(sampleMask(frames, 1), 0);
  assert.equal(sampleMask(frames, 0.1), -100);
});
function mask(file) {
  const src = readFileSync(new URL(file, root), "utf8");
  const a = src.indexOf("var WebMaskAnimator = class"),
    b = src.indexOf("//#endregion", a);
  return runInNewContext(src.slice(a, b) + ";WebMaskAnimator", {
    generateFadeGradient: () => ["gradient", 2.5],
    sampleMask,
    console,
  });
}
test("软件遮罩沿用上游关键帧，包含 ruby 的 500 个采样位置一致", () => {
  const words = [0, 1, 2].map((i) => ({
    word: "test",
    width: 40 + i * 10,
    height: 30,
    padding: 30,
    startTime: i * 1400,
    endTime: i * 1400 + 1000,
    ruby:
      i === 1
        ? [
            { word: "a", startTime: 1400, endTime: 1700 },
            { word: "bc", startTime: 1850, endTime: 2400 },
          ]
        : [],
    mainElement: {
      style: { removeProperty() {} },
      animate(frames) {
        this.frames = frames;
        return { pause() {}, cancel() {} };
      },
    },
  }));
  const context = { lineStartTime: 0, lineEndTime: 4000, wordFadeWidth: 0.5 };
  const a = new (mask("upstream.mjs"))(words, context);
  a.apply();
  const b = new (mask("amll-core.mjs"))(words, context);
  b.apply();
  for (let t = 0; t <= 4000; t += 8) {
    b.setCurrentTime(t, true);
    for (const w of words) {
      const frames = w.mainElement.frames;
      let left = frames[0],
        right = frames[frames.length - 1];
      for (const f of frames) {
        if (f.offset <= t / 4000) left = f;
        else {
          right = f;
          break;
        }
      }
      const lo = parseFloat(left.maskPosition),
        hi = parseFloat(right.maskPosition);
      const expected =
        right.offset === left.offset
          ? lo
          : lo + ((hi - lo) * (t / 4000 - left.offset)) / (right.offset - left.offset);
      assert.ok(
        Math.abs(parseFloat(w.mainElement.style.maskPosition) - expected) <= 0.006,
        `time ${t}`,
      );
    }
  }
});
