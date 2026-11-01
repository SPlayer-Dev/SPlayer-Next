import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RequestFn } from "../core/types";
import userRecord from "./user_record";

describe("听歌排行查询", () => {
  for (const query of [
    { uid: 123 },
    { uid: 123, type: 1 },
    { uid: 123, type: 1, limit: 50, offset: 100 },
  ]) {
    it(`保留排行类型与分页参数 ${JSON.stringify(query)}`, async () => {
      const response = { status: 200, body: { code: 200, weekData: [] }, cookie: [] };
      const request: RequestFn = async (path, data, options) => {
        assert.equal(path, "/api/v1/play/record");
        assert.deepEqual(data, {
          uid: 123,
          type: query.type ?? 0,
          offset: query.offset ?? 0,
          total: true,
          limit: query.limit ?? 120,
        });
        assert.equal(options.crypto, "weapi");
        return response;
      };
      assert.equal(await userRecord(query, request), response);
    });
  }
});
