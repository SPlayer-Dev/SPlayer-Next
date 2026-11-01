import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RequestFn } from "../core/types";
import recordRecentSong from "./record_recent_song";

describe("最近播放歌曲查询", () => {
  for (const limit of [undefined, 1, 100]) {
    it(`limit 为 ${limit} 时通过网页协议读取原始记录`, async () => {
      const response = {
        status: 200,
        body: { code: 200, data: { list: [{ resourceId: 123, playTime: 1700000000000 }] } },
        cookie: [],
      };
      const cookie = { MUSIC_U: "test-session" };
      const request: RequestFn = async (path, data, options) => {
        assert.equal(path, "/api/play-record/song/list");
        assert.deepEqual(data, { limit: limit ?? 100 });
        assert.equal(options.crypto, "weapi");
        assert.equal(options.client, "web");
        assert.equal(options.cookie, cookie);
        return response;
      };
      assert.equal(await recordRecentSong({ limit, cookie }, request), response);
    });
  }
});
