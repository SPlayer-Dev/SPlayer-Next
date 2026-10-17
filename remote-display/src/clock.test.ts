import assert from "node:assert/strict";
import { test } from "node:test";
import { PlaybackClock } from "./clock";

test("不同机器时钟不一致时按往返时延校准，倍速和暂停正确", () => {
  const c = new PlaybackClock();
  c.calibrate(100, 120, 900010);
  c.sync({ position: 1000, playing: true, speed: 2, sendTimestamp: 900020 }, 130, true);
  assert.equal(c.current(230), 1220);
  c.sync({ position: 1220, playing: false, speed: 2, sendTimestamp: 900120 }, 230);
  assert.equal(c.current(5000), 1220);
});

test("小幅网络抖动不重置动画，大幅跳转立即生效，断线冻结", () => {
  const c = new PlaybackClock();
  c.sync({ position: 1000, playing: true, speed: 1, sendTimestamp: 0 }, 0);
  assert.equal(c.sync({ position: 1180, playing: true, speed: 1, sendTimestamp: 0 }, 200), false);
  assert.equal(c.current(300), 1300);
  assert.equal(c.sync({ position: 50000, playing: true, speed: 1, sendTimestamp: 0 }, 300), true);
  assert.equal(c.current(400), 50100);
  c.freeze(400);
  assert.equal(c.current(4000), 50100);
});
