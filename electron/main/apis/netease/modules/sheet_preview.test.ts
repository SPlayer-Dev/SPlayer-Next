import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RequestFn } from "../core/types";
import sheetPreview from "./sheet_preview";

describe("乐谱预览图查询", () => {
  it("通过 eapi 请求乐谱预览并透传原始响应", async () => {
    const response = {
      status: 200,
      body: { code: 200, data: [{ id: 1, url: "https://example.com/sheet.png" }] },
      cookie: [],
    };
    const request: RequestFn = async (path, data, options) => {
      assert.equal(path, "/api/music/sheet/preview/info");
      assert.deepEqual(data, { id: "sheet-123" });
      assert.equal(options.crypto, "eapi");
      return response;
    };
    assert.equal(await sheetPreview({ id: "sheet-123" }, request), response);
  });
});
