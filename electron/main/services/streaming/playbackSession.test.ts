import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StreamingPlaybackSession } from "./playbackSession";
import type { StreamingPlaybackReport } from "./adapters/types";

describe("服务器播放会话", () => {
  it("预加载和仅暂停的加载不会上报播放", async () => {
    const events: StreamingPlaybackReport[] = [];
    const session = new StreamingPlaybackSession(
      { trackId: "1", sessionId: "a", durationMs: 10000 },
      async (event) => {
        events.push(event);
      },
    );
    session.state(false);
    session.seek(9000);
    await session.stop();
    assert.equal(events.length, 0);
  });

  it("暂停、跳转和长时间断流不能累计为听歌打卡", async () => {
    let now = 0;
    const events: StreamingPlaybackReport[] = [];
    const session = new StreamingPlaybackSession(
      { trackId: "1", sessionId: "a", durationMs: 20000 },
      async (event) => {
        events.push(event);
      },
      () => now,
      () => 123456,
    );
    session.state(true);
    now = 1000;
    session.position(1000);
    session.state(false);
    now = 100000;
    session.position(1000);
    session.seek(19000);
    session.state(true);
    now += 100000;
    session.position(19000);
    await session.stop();
    assert.equal(events.filter((event) => event.event === "scrobble").length, 0);
    assert.equal(events[0].startedAt, 123456);
    assert.equal(events.at(-1)?.positionMs, 19000);
  });

  it("半曲真实收听只打卡一次，停止和心跳保持正确顺序", async () => {
    let now = 0;
    const events: StreamingPlaybackReport[] = [];
    const session = new StreamingPlaybackSession(
      { trackId: "1", sessionId: "a", durationMs: 20000 },
      async (event) => {
        events.push(event);
      },
      () => now,
    );
    session.state(true);
    for (let i = 1; i <= 20; i++) {
      now += 1000;
      session.position(i * 1000);
    }
    await session.stop();
    await session.stop();
    assert.equal(events.filter((event) => event.event === "start").length, 1);
    assert.equal(events.filter((event) => event.event === "scrobble").length, 1);
    assert.equal(events.filter((event) => event.event === "stop").length, 1);
    assert.ok(events.some((event) => event.event === "progress"));
    assert.equal(events.at(-1)?.event, "stop");
  });

  it("服务端请求延迟时上千次跳转只保留最后进度", async () => {
    const events: StreamingPlaybackReport[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = new StreamingPlaybackSession(
      { trackId: "1", sessionId: "a", durationMs: 20000 },
      async (event) => {
        events.push(event);
        if (event.event === "start") await gate;
      },
    );
    session.state(true);
    for (let i = 0; i < 1000; i++) session.seek(i);
    const stopped = session.stop();
    release();
    await stopped;
    assert.deepEqual(
      events.map((event) => event.event),
      ["start", "progress", "stop"],
    );
    assert.equal(events[1].positionMs, 999);
  });
});
