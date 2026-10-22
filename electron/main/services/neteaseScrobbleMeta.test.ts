import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Track } from "../../../shared/types/player";
import { toNeteaseScrobbleTrack } from "../../../shared/utils/neteaseScrobble";
const track: Track = {
  id: "123",
  source: "netease",
  title: "测试歌曲",
  artists: [{ name: "测试" }],
  duration: 180000,
};
describe("网页日志的轻量资源信息", () => {
  it("歌曲仅提取标识、类型、标题和引擎时长", () => {
    assert.deepEqual(toNeteaseScrobbleTrack(track, undefined, 236200), {
      id: "123",
      resourceType: "song",
      title: "测试歌曲",
      durationSec: 236,
    });
  });
  it("播客声音使用节目资源标识和类型", () => {
    assert.deepEqual(toNeteaseScrobbleTrack({ ...track, extId: "3081133072" }, undefined, 10000), {
      id: "3081133072",
      resourceType: "dj",
      title: "测试歌曲",
      durationSec: 10,
    });
  });
  it("来源上下文不产生官方网页未携带的来源字段", () => {
    const result = toNeteaseScrobbleTrack(
      track,
      { provider: "netease", originType: "playlist", originId: "456" },
      180000,
    );
    assert.deepEqual(result, toNeteaseScrobbleTrack(track, undefined, 180000));
  });
  it("NCBL 保留曲目来源和音质，播客使用电台来源", () => {
    const context = { provider: "netease", originType: "playlist", originId: "456" } as const;
    assert.deepEqual(toNeteaseScrobbleTrack(track, context, 180000, "ncbl")?.ncbl, {
      sourceid: "456",
      sourceType: "list",
      artist: "测试",
      bitrate: 320,
      level: "higher",
      fee: 0,
    });
    const voice = { ...track, extId: "789", album: { id: "321", name: "播客" } };
    const result = toNeteaseScrobbleTrack(voice, undefined, 10000, "ncbl");
    assert.equal(result?.id, "789");
    assert.equal(result?.ncbl?.sourceid, "321");
    assert.equal(result?.ncbl?.sourceType, "radio");
  });
  it("无效标识和其他来源不进入平台日志", () => {
    assert.equal(toNeteaseScrobbleTrack(null, undefined, 180000), null);
    for (const id of ["0", "wrong", ""])
      assert.equal(toNeteaseScrobbleTrack({ ...track, id }, undefined, 180000), null);
    for (const source of ["local", "qqmusic", "kugou"] as const)
      assert.equal(toNeteaseScrobbleTrack({ ...track, source }, undefined, 180000), null);
  });
});
