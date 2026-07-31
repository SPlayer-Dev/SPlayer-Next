import { beforeEach, describe, expect, it, vi } from "vitest";
import * as playback from "./playback";

describe("playback", () => {
  let now = 0;

  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    playback.reset();
    playback.setSpeed(1);
  });

  it("播放时根据墙钟插值并限制在总时长内", () => {
    playback.setDuration(5_000);
    playback.setCurrentTime(1_000, { force: true });
    playback.setPlaying(true);

    now = 750;
    expect(playback.getCurrentTime()).toBe(1_750);

    now = 10_000;
    expect(playback.getCurrentTime()).toBe(5_000);
  });

  it("切换播放状态后的首个位置推送执行强制重锚", () => {
    playback.setDuration(10_000);
    playback.setCurrentTime(1_000, { force: true });
    playback.setPlaying(true);
    now = 200;

    expect(playback.setCurrentTime(4_000)).toBe(4_000);
    expect(playback.getCurrentTime()).toBe(4_000);
  });

  it("小幅同步偏差平滑收敛而不是直接回跳", () => {
    playback.setDuration(10_000);
    playback.setCurrentTime(1_000, { force: true });
    playback.setPlaying(true);
    playback.setCurrentTime(1_000);

    now = 500;
    expect(playback.setCurrentTime(1_400)).toBe(1_480);
  });

  it("变速时保持当前位置连续并使用新速度插值", () => {
    playback.setDuration(10_000);
    playback.setCurrentTime(1_000, { force: true });
    playback.setPlaying(true);

    now = 1_000;
    playback.setSpeed(2);
    now = 1_500;

    expect(playback.getCurrentTime()).toBe(3_000);
  });

  it("暂停时冻结当前可见位置", () => {
    playback.setDuration(10_000);
    playback.setCurrentTime(1_000, { force: true });
    playback.setPlaying(true);
    now = 600;

    playback.setPlaying(false);
    now = 2_000;

    expect(playback.getCurrentTime()).toBe(1_600);
    expect(playback.isPlaying()).toBe(false);
  });
});
