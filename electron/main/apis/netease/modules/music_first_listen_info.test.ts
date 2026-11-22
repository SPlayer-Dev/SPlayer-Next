import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RequestFn } from "../core/types";
import musicFirstListenInfo from "./music_first_listen_info";

describe("歌曲首次聆听信息查询", () => {
  it("通过 eapi 请求聆听故事并透传原始响应", async () => {
    const response = {
      status: 200,
      body: { code: 200, data: { musicFirstListenDto: { season: "夏", period: "深夜" } } },
      cookie: [],
    };
    const request: RequestFn = async (path, data, options) => {
      assert.equal(path, "/api/content/activity/music/first/listen/info");
      assert.deepEqual(data, { songId: "1958384591" });
      assert.equal(options.crypto, "eapi");
      return response;
    };
    assert.equal(await musicFirstListenInfo({ songId: "1958384591" }, request), response);
  });
});
