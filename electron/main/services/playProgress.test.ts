import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPlayProgress } from "./playProgress";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 立即达标，用于验证触发时机本身 */
const immediate = (): number => 0;

describe("播放进度计时器", () => {
  it("达标不立即上报，结算时按本轮最终累计时长触发", async () => {
    const calls: Array<{ name: string; playedMs: number }> = [];
    const progress = createPlayProgress<{ name: string }>({
      onThreshold: (payload, playedMs) => calls.push({ name: payload.name, playedMs }),
      thresholdMs: immediate,
    });

    progress.load(100, { name: "A" }, true);
    progress.tick();
    assert.equal(calls.length, 0, "达标瞬间不应上报");
    assert.equal(progress.hasFired(), true, "已达标，待结算");

    await sleep(60);
    progress.end();

    assert.equal(calls.length, 1);
    // 关键：上报的是本轮最终累计时长，而非达标瞬间的累计值
    assert.ok((calls[0]?.playedMs ?? 0) >= 50);
  });

  it("切歌先按最终时长结算上一首", async () => {
    const calls: Array<{ name: string; playedMs: number }> = [];
    const progress = createPlayProgress<{ name: string }>({
      onThreshold: (payload, playedMs) => calls.push({ name: payload.name, playedMs }),
      thresholdMs: immediate,
    });

    progress.load(100, { name: "A" }, true);
    await sleep(60);
    progress.load(100, { name: "B" }, true);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, "A");
    assert.ok((calls[0]?.playedMs ?? 0) >= 50);
    assert.equal(progress.hasFired(), false, "新一轮应重新计时");
  });

  it("本轮只触发一次", async () => {
    const calls: string[] = [];
    const progress = createPlayProgress<string>({
      onThreshold: (payload) => calls.push(payload),
      thresholdMs: immediate,
    });

    progress.load(100, "A", true);
    await sleep(30);
    progress.tick();
    progress.tick();
    progress.end();
    progress.end();
    assert.deepEqual(calls, ["A"]);
  });

  it("开关关着时结算不上报", async () => {
    let enabled = false;
    const calls: string[] = [];
    const progress = createPlayProgress<string>({
      onThreshold: (payload) => calls.push(payload),
      thresholdMs: immediate,
      shouldFire: () => enabled,
    });

    progress.load(100, "A", true);
    progress.tick();
    progress.end();
    assert.deepEqual(calls, [], "开关关着时不应占用本轮");

    enabled = true;
    progress.load(100, "B", true);
    progress.end();
    assert.deepEqual(calls, ["B"]);
  });

  it("rearm 会丢弃待结算的达标并重新计时", async () => {
    const calls: string[] = [];
    const progress = createPlayProgress<string>({
      onThreshold: (payload) => calls.push(payload),
      thresholdMs: () => 100,
    });

    progress.load(100, "A", true);
    await sleep(120);
    progress.tick();
    assert.equal(progress.hasFired(), true);

    progress.rearm();
    assert.equal(progress.hasFired(), false);

    progress.end();
    assert.deepEqual(calls, [], "rearm 后未再次达标不应上报");
  });
});
