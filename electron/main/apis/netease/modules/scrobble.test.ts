import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Query } from "../core/option";
import type { RequestFn } from "../core/types";
import scrobble from "./scrobble";

const createRequest = () => {
  const calls: Array<{ data: Record<string, unknown> }> = [];
  const request = (async (_uri, data) => {
    calls.push({ data });
    return { status: 200, body: { code: 200 }, cookie: [] };
  }) as RequestFn;
  return { calls, request };
};

describe("网易云原版日志听歌打卡", () => {
  const sourceCases = [
    ["list", "song", "list"],
    ["album", "song", "album"],
    ["artist", "song", "artist"],
    ["song", "song", "track"],
    ["radio", "dj", "djradio"],
  ] as const;

  for (const [sourceType, resourceType, expected] of sourceCases) {
    it(`将 ${sourceType} 来源的 ${resourceType} 资源映射为 ${expected}`, async () => {
      const { calls, request } = createRequest();
      const resourceId = resourceType === "dj" ? "3081133072" : "123";

      await scrobble(
        {
          id: resourceId,
          sourceid: "456",
          sourceType,
          resourceType,
          time: 60,
          categoryId: resourceType === "dj" ? 7 : undefined,
          cookie: {},
        } satisfies Query,
        request,
      );

      assert.equal(calls.length, 2);
      const [startplay] = JSON.parse(String(calls[0]?.data.logs));
      const [play] = JSON.parse(String(calls[1]?.data.logs));
      for (const log of [startplay, play]) {
        assert.deepEqual(
          {
            id: log.json.id,
            type: log.json.type,
            sourceId: log.json.sourceId,
            source: log.json.source,
            sourcetype: log.json.sourcetype,
            categoryId: log.json.categoryId,
          },
          {
            id: resourceId,
            type: resourceType,
            sourceId: "456",
            source: expected,
            sourcetype: expected,
            categoryId: resourceType === "dj" ? 7 : undefined,
          },
        );
      }
    });
  }

  it("任一原版日志请求失败时返回失败状态", async () => {
    let requestCount = 0;
    const request: RequestFn = async () => {
      requestCount += 1;
      const code = requestCount === 1 ? 200 : 500;
      return { status: code, body: { code }, cookie: [] };
    };

    const result = await scrobble(
      { id: "123", sourceid: "123", time: 60, cookie: {} } satisfies Query,
      request,
    );

    assert.equal(result.status, 502);
    assert.equal(result.body.code, 502);
    assert.equal(result.body.msg, "原版日志上报失败");
  });
});
