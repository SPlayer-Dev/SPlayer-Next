import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseStreamingSource,
  streamingSourceForTrack,
} from "../../../../shared/utils/streamingSource";
import type { Track } from "../../../../shared/types/player";
const track: Track = {
  id: "server:song",
  serverId: "server",
  originalId: "歌曲/1",
  source: "streaming",
  title: "歌曲",
  artists: [],
  duration: 1000,
};
describe("流媒体媒体身份", () => {
  it("旧配置保留原占位符格式，账号变化后携带媒体代次", () => {
    const old = streamingSourceForTrack(track);
    assert.equal(old, "streaming://server/%E6%AD%8C%E6%9B%B2%2F1");
    const next = streamingSourceForTrack({ ...track, serverRevision: 2 });
    assert.deepEqual(parseStreamingSource(next), {
      serverId: "server",
      trackId: "歌曲/1",
      serverRevision: 2,
    });
    assert.equal(parseStreamingSource(old).serverRevision, 0);
  });
  it("拒绝凭据参数和无效身份代次", () => {
    for (const query of ["revision=-1", "revision=1.5", "revision=bad", "api_key=secret"])
      assert.throws(() => parseStreamingSource("streaming://server/song?" + query));
  });
});
