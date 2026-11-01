import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
const state = vi.hoisted(() => ({ revision: 0, report: vi.fn(), resolve: vi.fn() }));
vi.mock("./config", () => ({
  getStreamingConfig: () => ({ servers: [{ id: "server", mediaRevision: state.revision }] }),
}));
vi.mock("./mediaSource", () => ({ resolveStreamingMediaSource: state.resolve }));
vi.mock("./connection", () => ({
  withStreamingAdapter: async (_id, request) =>
    request({ type: "navidrome" }, { reportPlayback: state.report }),
}));
vi.mock("@main/utils/logger", () => ({ streamingLog: { warn: vi.fn() } }));
import {
  prepareStreamingPlayback,
  startStreamingPlayback,
  stopStreamingPlayback,
  onStreamingState,
} from "./playback";
const track: Track = {
  id: "server:song",
  serverId: "server",
  originalId: "song",
  source: "streaming",
  title: "歌曲",
  artists: [],
  duration: 10000,
};
beforeEach(async () => {
  await stopStreamingPlayback();
  state.revision = 0;
  state.report.mockReset().mockResolvedValue(undefined);
  state.resolve.mockReset();
});
describe("主进程播放会话协调", () => {
  it("同曲重播获取新的音源会话，按旧停止、新开始的顺序上报", async () => {
    state.resolve.mockImplementation(async (_serverId, _trackId, sessionId) => ({
      url: "https://server/audio?PlaySessionId=" + sessionId,
      mediaSourceId: "media-source",
    }));
    const first = await prepareStreamingPlayback(track, "streaming://server/song");
    startStreamingPlayback(track, first, 10000, true);
    await vi.waitFor(() => expect(state.report).toHaveBeenCalledOnce());
    await stopStreamingPlayback();
    const second = await prepareStreamingPlayback(track, "streaming://server/song");
    expect(second!.sessionId).not.toBe(first!.sessionId);
    expect(new URL(second!.url).searchParams.get("PlaySessionId")).toBe(second!.sessionId);
    startStreamingPlayback(track, second, 10000, false);
    onStreamingState("playing");
    await vi.waitFor(() => expect(state.report).toHaveBeenCalledTimes(3));
    await stopStreamingPlayback();
    expect(state.report.mock.calls.map(([, report]) => [report.sessionId, report.event])).toEqual([
      [first!.sessionId, "start"],
      [first!.sessionId, "stop"],
      [second!.sessionId, "start"],
      [second!.sessionId, "stop"],
    ]);
  });
  it("缓存加载不连接服务器，实际播放后才上报", async () => {
    const prepared = await prepareStreamingPlayback(track, "C:/cache/song.wav");
    expect(state.resolve).not.toHaveBeenCalled();
    startStreamingPlayback(track, prepared, 10000, false);
    expect(state.report).not.toHaveBeenCalled();
    onStreamingState("playing");
    await vi.waitFor(() => expect(state.report).toHaveBeenCalledOnce());
    await stopStreamingPlayback();
    expect(state.report.mock.calls.map(([, report]) => report.event)).toEqual(["start", "stop"]);
  });
  it("账号变更后旧缓存曲目不能上报到新账号", async () => {
    state.revision = 1;
    await expect(prepareStreamingPlayback(track, "C:/cache/song.wav")).rejects.toThrow(
      "重新选择歌曲",
    );
    expect(state.resolve).not.toHaveBeenCalled();
  });
  it("旧停止请求结束前不会启动新服务器会话", async () => {
    let release!: () => void;
    state.report.mockImplementation(async (_config, report) => {
      if (report.event === "stop" && report.sessionId === "old")
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    });
    startStreamingPlayback(track, { url: "cached", sessionId: "old" }, 10000, true);
    await vi.waitFor(() => expect(state.report).toHaveBeenCalledOnce());
    const stopping = stopStreamingPlayback();
    await vi.waitFor(() => expect(release).toBeDefined());
    startStreamingPlayback(track, { url: "cached", sessionId: "new" }, 10000, true);
    expect(state.report.mock.calls).toHaveLength(2);
    release();
    await stopping;
    await vi.waitFor(() => expect(state.report).toHaveBeenCalledTimes(3));
    expect(state.report.mock.calls.map(([, report]) => [report.sessionId, report.event])).toEqual([
      ["old", "start"],
      ["old", "stop"],
      ["new", "start"],
    ]);
    await stopStreamingPlayback();
  });
});
