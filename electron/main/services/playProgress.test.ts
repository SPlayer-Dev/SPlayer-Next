import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPlayProgress } from "./playProgress";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 立即达标，用于验证触发时机本身 */
const immediate = (): number => 0;

describe("播放进度计时器", () => {
  it("达标瞬间即触发 onThreshold，不等待结算", async () => {
    const reached: string[] = [];
    const settled: string[] = [];
    const progress = createPlayProgress<string>({
      onThreshold: (payload) => reached.push(payload),
      onSettle: (payload) => settled.push(payload),
      thresholdMs: immediate,
    });

    progress.load(100, "A", true);
    progress.tick();

    assert.deepEqual(reached, ["A"], "达标瞬间即登记，与 Last.fm 时序一致");
    assert.deepEqual(settled, [], "时长未定格，尚不结算");

    progress.end();
    assert.deepEqual(settled, ["A"]);
  });

  it("轮次结算时按本轮最终累计时长回调，而非达标瞬间的值", async () => {
    const settled: Array<{ playedMs: number; fired: boolean }> = [];
    const progress = createPlayProgress<string>({
      onThreshold: () => {},
      onSettle: (_payload, playedMs, fired) => settled.push({ playedMs, fired }),
      thresholdMs: immediate,
    });

    progress.load(100, "A", true);
    progress.tick();
    await sleep(80);
    progress.end();

    assert.equal(settled.length, 1);
    assert.ok((settled[0]?.playedMs ?? 0) >= 70, "应上报本轮最终累计时长");
    assert.equal(settled[0]?.fired, true);
  });

  it("切歌时先按最终时长结算上一首", async () => {
    const settled: string[] = [];
    const progress = createPlayProgress<string>({
      onThreshold: () => {},
      onSettle: (payload) => settled.push(payload),
      thresholdMs: immediate,
    });

    progress.load(100, "A", true);
    await sleep(60);
    progress.load(100, "B", true);

    assert.deepEqual(settled, ["A"]);
    assert.equal(progress.hasFired(), false, "新一轮应重新计时");
  });

  it("本轮只结算一次，flush 后再 end 不重复上报", async () => {
    const settled: string[] = [];
    const progress = createPlayProgress<string>({
      onThreshold: () => {},
      onSettle: (payload) => settled.push(payload),
      thresholdMs: immediate,
    });

    progress.load(100, "A", true);
    await sleep(30);
    progress.flush();
    progress.end();

    assert.deepEqual(settled, ["A"]);
  });

  it("未达标的轮次结算时 fired 为 false", () => {
    const settled: boolean[] = [];
    const progress = createPlayProgress<string>({
      onThreshold: () => assert.fail("未达标不应触发"),
      onSettle: (_payload, _playedMs, fired) => settled.push(fired),
      thresholdMs: () => 1000,
    });

    progress.load(100, "A", true);
    progress.end();

    assert.deepEqual(settled, [false]);
  });

  it("开关关着时不触发，中途打开后仍可补发", () => {
    let enabled = false;
    const settled: boolean[] = [];
    const progress = createPlayProgress<string>({
      onThreshold: () => {},
      onSettle: (_payload, _playedMs, fired) => settled.push(fired),
      thresholdMs: immediate,
      shouldFire: () => enabled,
    });

    progress.load(100, "A", true);
    progress.tick();
    assert.equal(progress.hasFired(), false, "开关关着时不占用本轮");

    enabled = true;
    progress.tick();
    assert.equal(progress.hasFired(), true);

    progress.end();
    assert.deepEqual(settled, [true]);
  });

  it("flush 结算后不清空本轮，仍在播放时继续计时", async () => {
    const settled: number[] = [];
    const progress = createPlayProgress<string>({
      onThreshold: () => {},
      onSettle: (_payload, playedMs) => settled.push(playedMs),
      thresholdMs: immediate,
    });

    progress.load(100, "A", true);
    await sleep(30);
    const beforeFlush = progress.elapsedMs();
    progress.flush();
    await sleep(30);

    assert.equal(settled.length, 1, "本轮已结算，后续播放不再重复上报");
    assert.ok(
      progress.elapsedMs() > beforeFlush + 20,
      "flush 不是清空，仍在播放时继续累计，rearm 后仍能开启新一轮",
    );
  });

  it("同曲重播：flush 结算上一轮后 rearm，两轮各上报一次", async () => {
    const settled: string[] = [];
    const progress = createPlayProgress<string>({
      onThreshold: () => {},
      onSettle: (payload) => settled.push(payload),
      thresholdMs: immediate,
    });

    progress.load(100, "A", true);
    await sleep(30);
    progress.flush();
    progress.rearm();
    await sleep(30);
    progress.end();

    assert.deepEqual(settled, ["A", "A"], "上一轮不因 rearm 丢失，新一轮可再次上报");
  });

  it("rearm 后新一轮未达阈值则不上报", async () => {
    const settled: boolean[] = [];
    const progress = createPlayProgress<string>({
      onThreshold: () => {},
      onSettle: (_payload, _playedMs, fired) => settled.push(fired),
      thresholdMs: () => 200,
    });

    progress.load(100, "A", true);
    await sleep(60);
    progress.flush();
    progress.rearm();
    await sleep(30);
    progress.end();

    assert.deepEqual(settled, [false, false]);
  });
});
