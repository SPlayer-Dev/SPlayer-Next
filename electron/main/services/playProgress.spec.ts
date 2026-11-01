import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlayProgress } from "./playProgress";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1700000000000);
});
afterEach(() => vi.useRealTimers());
describe("播放计时与轮次结算", () => {
  it("只有结算回调的消费者不执行任何阈值判断", async () => {
    const thresholdMs = vi.fn(() => {
      throw new Error("不应判断阈值");
    });
    const settle = vi.fn();
    const progress = createPlayProgress({ onSettle: settle, thresholdMs });
    progress.load(256, "song", true);
    await vi.advanceTimersByTimeAsync(128000);
    progress.tick();
    expect(settle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(128000);
    progress.end();
    expect(settle).toHaveBeenCalledExactlyOnceWith("song", 256000);
    expect(thresholdMs).not.toHaveBeenCalled();
  });
  it("阈值与最终结算独立，暂停和重复结算不增加时长或次数", async () => {
    const reached = vi.fn();
    const settled = vi.fn();
    const progress = createPlayProgress({ onThreshold: reached, onSettle: settled });
    progress.load(100, "song", true);
    await vi.advanceTimersByTimeAsync(50000);
    progress.tick();
    expect(reached).toHaveBeenCalledExactlyOnceWith("song", 50000);
    progress.setPlaying(false);
    await vi.advanceTimersByTimeAsync(600000);
    progress.setPlaying(true);
    await vi.advanceTimersByTimeAsync(50000);
    progress.end();
    progress.end();
    expect(settled).toHaveBeenCalledExactlyOnceWith("song", 100000);
  });
  it("切歌和重播各结算一次，重播清除旧轮次的累计时长", async () => {
    const settle = vi.fn();
    const progress = createPlayProgress({ onSettle: settle });
    progress.load(100, "a", true);
    await vi.advanceTimersByTimeAsync(10000);
    progress.rearm();
    await vi.advanceTimersByTimeAsync(20000);
    progress.load(100, "b", true);
    await vi.advanceTimersByTimeAsync(30000);
    progress.end();
    expect(settle.mock.calls).toEqual([
      ["a", 10000],
      ["a", 20000],
      ["b", 30000],
    ]);
  });
});
