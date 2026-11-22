import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RequestFn } from "../core/types";
import sheetList from "./sheet_list";

describe("乐谱列表查询", () => {
  it("通过 eapi 请求歌曲的完整乐谱列表", async () => {
    const response = {
      status: 200,
      body: { code: 200, data: { musicSheetSimpleInfoVOS: [] } },
      cookie: [],
    };
    const request: RequestFn = async (path, data, options) => {
      assert.equal(path, "/api/music/sheet/list/v1");
      assert.deepEqual(data, { id: "song-123", abTest: "b" });
      assert.equal(options.crypto, "eapi");
      return response;
    };
    assert.equal(await sheetList({ id: "song-123" }, request), response);
  });
});
