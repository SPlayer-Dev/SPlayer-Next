import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as scrobbler from "./scrobbler";
const threshold = vi.fn();
const nowPlaying = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1700000000000);
  vi.resetAllMocks();
  scrobbler.reset();
  scrobbler.setHandlers({ onScrobble: threshold, onNowPlaying: nowPlaying });
});
afterEach(() => {
  scrobbler.reset();
  vi.useRealTimers();
});
describe("独立的单曲重播统计", () => {
  it("每轮重新生成时间戳并保留过半上报，结束不会重复提交", async () => {
    scrobbler.onTrackLoaded({
      title: "测试",
      artist: "测试",
      album: "",
      durationMs: 236000,
      autoPlay: true,
    });
    for (let cycle = 0; cycle < 8; cycle++) {
      if (cycle) {
        await vi.advanceTimersByTimeAsync(600000);
        scrobbler.onRepeatOneRestart();
        expect(nowPlaying).toHaveBeenCalledTimes(cycle);
        scrobbler.onState(true);
      }
      await vi.advanceTimersByTimeAsync(118000);
      scrobbler.onPosition();
      expect(threshold).toHaveBeenCalledTimes(cycle + 1);
      await vi.advanceTimersByTimeAsync(118000);
      scrobbler.onEnded();
      scrobbler.onState(false);
    }
    expect(threshold).toHaveBeenCalledTimes(8);
    expect(nowPlaying).toHaveBeenCalledTimes(8);
    expect(new Set(threshold.mock.calls.map(([track]) => track.timestamp)).size).toBe(8);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("暂停时间不进入阈值，停止后释放可重播的曲目", async () => {
    scrobbler.onTrackLoaded({
      title: "测试",
      artist: "测试",
      album: "",
      durationMs: 100000,
      autoPlay: false,
    });
    await vi.advanceTimersByTimeAsync(1000000);
    scrobbler.onState(true);
    await vi.advanceTimersByTimeAsync(20000);
    scrobbler.onState(false);
    await vi.advanceTimersByTimeAsync(1000000);
    scrobbler.onPosition();
    expect(threshold).not.toHaveBeenCalled();
    scrobbler.onStopped();
    scrobbler.onRepeatOneRestart();
    scrobbler.onState(true);
    await vi.advanceTimersByTimeAsync(1000000);
    scrobbler.onPosition();
    expect(threshold).not.toHaveBeenCalled();
    expect(nowPlaying).toHaveBeenCalledTimes(1);
  });
});
