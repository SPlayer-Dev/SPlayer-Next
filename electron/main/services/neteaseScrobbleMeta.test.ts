import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Track } from "../../../shared/types/player";
import {
  neteaseScrobbleThresholdMs,
  toNeteaseScrobbleTrack,
} from "../../../shared/utils/neteaseScrobble";

const track: Track = {
  id: "123",
  source: "netease",
  title: "测试歌曲",
  artists: [{ name: "歌手" }],
  album: { id: "999", name: "不应作为来源的专辑" },
  duration: 180000,
  fee: 1,
};

describe("网易云听歌打卡元数据", () => {
  it("短音频也会在播放过半后触发打卡", () => {
    assert.equal(neteaseScrobbleThresholdMs(15), 7500);
    assert.equal(neteaseScrobbleThresholdMs(30), 15000);
    assert.equal(neteaseScrobbleThresholdMs(600), 240000);
    assert.equal(neteaseScrobbleThresholdMs(0), Infinity);
  });

  it("没有播放上下文时以歌曲自身作为来源", () => {
    assert.deepEqual(toNeteaseScrobbleTrack(track, undefined, 180000), {
      id: "123",
      sourceId: "123",
      sourceType: "song",
      resourceType: "song",
      title: "测试歌曲",
      artist: "歌手",
      bitrate: 320,
      level: "higher",
      fee: 1,
      durationSec: 180,
    });
  });

  const sourceCases = [
    ["playlist", "list", "456"],
    ["album", "album", "999"],
    ["artist", "artist", "789"],
  ] as const;

  for (const [originType, sourceType, sourceId] of sourceCases) {
    it(`将通用 ${originType} 来源映射为 ${sourceType}`, () => {
      const value = toNeteaseScrobbleTrack(
        track,
        { provider: "netease", originId: sourceId, originType },
        180000,
      );
      assert.ok(value);
      assert.deepEqual(
        {
          sourceId: value.sourceId,
          sourceType: value.sourceType,
          resourceType: value.resourceType,
        },
        { sourceId, sourceType, resourceType: "song" },
      );
    });
  }

  it("播客声音使用节目 ID 和播客来源", () => {
    const value = toNeteaseScrobbleTrack(
      {
        ...track,
        id: "2725832901",
        extId: "3081133072",
        album: { id: "9988", name: "测试播客" },
      },
      { provider: "netease", originId: "9988", originType: "radio" },
      180000,
    );
    assert.ok(value);
    assert.deepEqual(
      {
        id: value.id,
        sourceId: value.sourceId,
        sourceType: value.sourceType,
        resourceType: value.resourceType,
      },
      {
        id: "3081133072",
        sourceId: "9988",
        sourceType: "radio",
        resourceType: "dj",
      },
    );
  });

  it("搜索结果中的声音从专辑字段恢复播客来源", () => {
    const value = toNeteaseScrobbleTrack(
      {
        ...track,
        id: "2725832901",
        extId: "3081133072",
        album: { id: "9988", name: "测试播客" },
      },
      undefined,
      180000,
    );
    assert.ok(value);
    assert.deepEqual(
      {
        id: value.id,
        sourceId: value.sourceId,
        sourceType: value.sourceType,
        resourceType: value.resourceType,
      },
      {
        id: "3081133072",
        sourceId: "9988",
        sourceType: "radio",
        resourceType: "dj",
      },
    );
  });

  it("忽略其他平台的播放上下文", () => {
    const value = toNeteaseScrobbleTrack(
      track,
      { provider: "qqmusic", originId: "456", originType: "playlist" },
      180000,
    );

    assert.equal(value?.sourceId, "123");
    assert.equal(value?.sourceType, "song");
  });

  it("应用页面来源不改变网易云打卡来源", () => {
    const value = toNeteaseScrobbleTrack(
      track,
      { originId: "cloud", originType: "page", originName: "我的云盘" },
      180000,
    );

    assert.equal(value?.sourceId, "123");
    assert.equal(value?.sourceType, "song");
  });
});
