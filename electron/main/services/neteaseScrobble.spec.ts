import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
const mocks = vi.hoisted(() => ({
  account: "account-a",
  enabled: true,
  mode: "legacy",
  call: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@main/store", () => ({
  store: {
    get: (key: string) => (key === "system.neteaseScrobbleMode" ? mocks.mode : mocks.enabled),
  },
}));
vi.mock("@main/apis/netease", () => ({
  callNetease: mocks.call,
  getNeteaseCookies: () => ({ MUSIC_U: mocks.account }),
}));
vi.mock("@main/utils/logger", () => ({ neteaseLog: { debug: vi.fn(), warn: mocks.warn } }));
let service: typeof import("./neteaseScrobble");
const track: Track = {
  id: "123",
  source: "netease",
  title: "测试",
  artists: [{ name: "测试" }],
  duration: 256000,
};
const reports = (action: string) =>
  mocks.call.mock.calls
    .filter(([, params]) => params.action === action)
    .map(([, params]) => params);
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  mocks.account = "account-a";
  mocks.enabled = true;
  mocks.mode = "legacy";
  mocks.call.mockResolvedValue({ status: 200, body: { code: 200 } });
  service = await import("./neteaseScrobble");
});
afterEach(async () => {
  service.onStopped();
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
});
describe("播放日志轮次", () => {
  it("NCBL 保留来源元数据，仅在结算时上报且轮次内切换设置不改变协议", async () => {
    mocks.mode = "ncbl";
    service.onTrackLoaded(
      track,
      { provider: "netease", originType: "playlist", originId: "456" },
      256000,
      true,
    );
    expect(mocks.call).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(128000);
    service.onState(false);
    await vi.advanceTimersByTimeAsync(600000);
    mocks.mode = "legacy";
    service.onState(true);
    await vi.advanceTimersByTimeAsync(128000);
    service.onEnded();
    service.onEnded();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.call).toHaveBeenCalledWith("scrobble_v1", {
      id: "123",
      resourceType: "song",
      sourceid: "456",
      sourceType: "list",
      name: "测试",
      artist: "测试",
      bitrate: 320,
      level: "higher",
      fee: 0,
      total: 256,
      time: 256,
      cookie: { MUSIC_U: "account-a" },
    });
    service.onTrackLoaded(track, undefined, 256000, true);
    expect(reports("startPlay")).toHaveLength(1);
  });
  it("NCBL 单曲循环每轮仅结算一次，保留修正后的循环计时", async () => {
    mocks.mode = "ncbl";
    service.onTrackLoaded(track, undefined, 256000, true);
    await vi.advanceTimersByTimeAsync(256000);
    service.onEnded();
    service.onRepeatOneRestart();
    service.onState(true);
    await vi.advanceTimersByTimeAsync(256000);
    service.onEnded();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.call.mock.calls.map(([name, params]) => [name, params.time])).toEqual([
      ["scrobble_v1", 256],
      ["scrobble_v1", 256],
    ]);
  });
  it("开始立即上报，播放过半不提交结束日志，完整收听只结算一次完整时长", async () => {
    service.onTrackLoaded(track, undefined, 256000, true);
    expect(reports("startPlay")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(128000);
    service.onPosition(128000);
    expect(reports("play")).toHaveLength(0);
    service.onState(false);
    await vi.advanceTimersByTimeAsync(600000);
    service.onState(true);
    await vi.advanceTimersByTimeAsync(128000);
    service.onEnded();
    service.onState(false);
    service.onEnded();
    expect(reports("startPlay")).toHaveLength(1);
    expect(reports("play").map((p) => p.time)).toEqual([256]);
  });
  it("短时间切歌也按实际收听时长发送日志，由服务端决定是否计数", async () => {
    service.onTrackLoaded(track, undefined, 600000, true);
    await vi.advanceTimersByTimeAsync(12000);
    service.onTrackLoaded({ ...track, id: "456" }, undefined, 180000, true);
    expect(reports("play").map((p) => [p.id, p.time])).toEqual([["123", 12]]);
    expect(reports("startPlay").map((p) => p.id)).toEqual(["123", "456"]);
  });
  it("单曲循环八轮各发送一次开始和结束，曲尾空闲时间不进入下一轮", async () => {
    service.onTrackLoaded(track, undefined, 236000, true);
    for (let cycle = 0; cycle < 8; cycle++) {
      if (cycle) {
        await vi.advanceTimersByTimeAsync(3600000);
        service.onRepeatOneRestart();
        service.onState(true);
      }
      await vi.advanceTimersByTimeAsync(236000);
      service.onEnded();
      service.onState(false);
    }
    expect(reports("startPlay")).toHaveLength(8);
    expect(reports("play").map((p) => p.time)).toEqual(Array(8).fill(236));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("暂停加载不发送开始日志，进度跳转不增加或重置收听时长", async () => {
    service.onTrackLoaded(track, undefined, 236000, false);
    service.onPosition(0);
    await vi.advanceTimersByTimeAsync(100000);
    expect(mocks.call).not.toHaveBeenCalled();
    service.onState(true);
    await vi.advanceTimersByTimeAsync(10000);
    service.onPosition(200000);
    service.onPosition(0);
    service.onStopped();
    expect(reports("play").map((p) => p.time)).toEqual([10]);
    expect(reports("startPlay")).toHaveLength(1);
  });
  it("主动停止不重复发送，停止后不能重新开启旧轮次", async () => {
    service.onTrackLoaded(track, undefined, 256000, true);
    await vi.advanceTimersByTimeAsync(150000);
    service.onStopped();
    service.onStopped();
    service.onState(true);
    service.onPosition(0);
    service.onStopped();
    service.onRepeatOneRestart();
    service.onState(true);
    service.onPosition(0);
    expect(reports("play").map((p) => p.time)).toEqual([150]);
    expect(reports("startPlay")).toHaveLength(1);
  });
  it("关闭开关和切换账号后不将旧轮次上报给新账号", async () => {
    service.onTrackLoaded(track, undefined, 256000, true);
    await vi.advanceTimersByTimeAsync(128000);
    mocks.account = "account-b";
    service.onEnded();
    service.onRepeatOneRestart();
    service.onState(true);
    expect(reports("play")).toHaveLength(0);
    expect(reports("startPlay")).toHaveLength(1);
    mocks.enabled = false;
    service.onTrackLoaded(track, undefined, 256000, true);
    await vi.advanceTimersByTimeAsync(10000);
    service.onStopped();
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });
  it("网络失败不重试结束日志，失败信息仍可见", async () => {
    mocks.call.mockRejectedValue(new Error("断网"));
    service.onTrackLoaded(track, undefined, 256000, true);
    await vi.advanceTimersByTimeAsync(150000);
    service.onEnded();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.call).toHaveBeenCalledTimes(2);
    expect(mocks.warn).toHaveBeenCalledTimes(2);
  });
  it("限制同时上报的请求数量，完成后允许后续正常上报", async () => {
    const finish: Array<() => void> = [];
    mocks.call.mockImplementation(
      () => new Promise((resolve) => finish.push(() => resolve({ body: { code: 200 } }))),
    );
    for (let cycle = 0; cycle < 20; cycle++) {
      service.onTrackLoaded(track, undefined, 10000, true);
      await vi.advanceTimersByTimeAsync(1000);
      service.onEnded();
    }
    expect(mocks.call).toHaveBeenCalledTimes(16);
    finish.forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(0);
    mocks.call.mockResolvedValue({ body: { code: 200 } });
    service.onTrackLoaded(track, undefined, 10000, true);
    expect(mocks.call).toHaveBeenCalledTimes(17);
  });
});
