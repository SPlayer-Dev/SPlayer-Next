import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPld,
  buildPlv,
  createPlaybackLogContext,
  toNcblSourceType,
  type PlaybackLogResource,
} from "./playLog";

const context = createPlaybackLogContext({});
const song: PlaybackLogResource = {
  id: 123,
  type: "song" as const,
  name: "测试歌曲",
  artist: "测试歌手",
  bitrate: 320,
  level: "exhigh",
  fee: 1,
  time: 180,
};

describe("网易云 NCBL 播放日志", () => {
  const sourceCases = [
    ["song", "song", "track"],
    ["song", "list", "list"],
    ["song", "album", "album"],
    ["song", "artist", "artist"],
    ["dj", "radio", "djradio"],
  ] as const;

  for (const [resourceType, sourceType, expected] of sourceCases) {
    it(`将 ${resourceType} 资源的 ${sourceType} 来源映射为 ${expected}`, () => {
      assert.equal(toNcblSourceType(resourceType, sourceType), expected);
    });
  }

  it("歌单与专辑保留来源 ID、类型和真实 fee", () => {
    const plv = buildPlv(context, song, { id: "456", type: "list", name: "list" });
    const pld = buildPld(context, song, { id: "999", type: "album", name: "album" }, 60);
    assert.deepEqual(
      {
        id: plv.id,
        sourceId: plv.sourceId,
        sourcetype: plv.sourcetype,
        fee: plv.fee,
      },
      { id: "123", sourceId: "456", sourcetype: "list", fee: 1 },
    );
    assert.deepEqual(
      {
        sourceId: pld.sourceId,
        sourcetype: pld.sourcetype,
        fee: pld.fee,
      },
      { sourceId: "999", sourcetype: "album", fee: 1 },
    );
    assert.equal("_addrefer" in plv, false);
    assert.equal("_multirefers" in pld, false);
  });

  it("PLV 与 PLD 保留网易云原始 fee", () => {
    for (const fee of [0, 1, 4, 8] as const) {
      const resource = { ...song, fee };
      const source = { id: "456", type: "list", name: "list" };

      assert.equal(buildPlv(context, resource, source).fee, fee);
      assert.equal(buildPld(context, resource, source, 60).fee, fee);
    }
  });

  it("声音以节目 ID 和 dj 类型写入日志", () => {
    const voice = {
      ...song,
      id: 3081133072,
      type: "dj" as const,
      categoryId: 7,
    };
    const source = { id: "9988", type: "djradio", name: "djradio" };

    for (const log of [buildPlv(context, voice, source), buildPld(context, voice, source, 60)]) {
      assert.deepEqual(
        {
          id: log.id,
          type: log.type,
          sourceId: log.sourceId,
          sourcetype: log.sourcetype,
          categoryId: log.categoryId,
        },
        {
          id: "3081133072",
          type: "dj",
          sourceId: "9988",
          sourcetype: "djradio",
          categoryId: 7,
        },
      );
    }
  });
});
