import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RequestFn } from "../core/types";
import scrobble from "./scrobble";

const response = { status: 200, body: { code: 200 }, cookie: ["server=value"] };

/** 浏览器实际播放的自然结束与切歌日志，用于约束请求字段 */
const capturedWebLogs = [
  {
    action: "play",
    json: {
      mainSite: "2",
      mainSiteWeb: "2",
      id: "1846515862",
      type: "song",
      content: "",
      time: 255,
      wifi: 0,
      download: 0,
    },
  },
  {
    action: "play",
    json: {
      mainSite: "2",
      mainSiteWeb: "2",
      id: "31654455",
      type: "song",
      content: "",
      time: 58,
      wifi: 0,
      download: 0,
    },
  },
];

describe("网页播放日志", () => {
  it("自然结束与切歌的参数逐项匹配浏览器实抓日志", async () => {
    for (const captured of capturedWebLogs) {
      const request: RequestFn = async (path, data, options) => {
        assert.equal(path, "/api/feedback/weblog");
        assert.equal(options.domain, "https://clientlogusf.music.163.com");
        assert.deepEqual(JSON.parse(String(data.logs)), [captured]);
        return response;
      };
      await scrobble(
        { id: captured.json.id, time: captured.json.time, action: captured.action },
        request,
      );
    }
  });
  for (const resourceType of ["song", "dj"] as const) {
    for (const action of ["startPlay", "play"] as const) {
      it(`${resourceType} 的 ${action} 使用官方网页字段和出口`, async () => {
        let count = 0;
        const request: RequestFn = async (path, data, options) => {
          count++;
          assert.equal(path, "/api/feedback/weblog");
          assert.equal(options.client, "web");
          assert.equal(options.crypto, "weapi");
          assert.equal(options.domain, "https://clientlogusf.music.163.com");
          assert.deepEqual(JSON.parse(String(data.logs)), [
            {
              action,
              json: {
                mainSite: "2",
                mainSiteWeb: "2",
                id: "123",
                type: resourceType,
                content: "",
                ...(action === "play" ? { time: 256, wifi: 0, download: 0 } : {}),
              },
            },
          ]);
          return response;
        };
        assert.equal(
          await scrobble(
            { id: 123, action, resourceType, time: action === "play" ? 256 : undefined },
            request,
          ),
          response,
        );
        assert.equal(count, 1);
      });
    }
  }
  it("业务响应原样返回，不将失败包装为成功", async () => {
    const failure = { status: 502, body: { code: 502, msg: "拒绝" }, cookie: [] };
    assert.equal(await scrobble({ id: 123, time: 90 }, async () => failure), failure);
  });
  it("开始日志无需时长，结束日志必须携带有效的实际时长", async () => {
    let count = 0;
    const request: RequestFn = async () => {
      count++;
      return response;
    };
    for (const query of [
      { id: "0", time: 1 },
      { id: 123, action: "wrong" },
      ...[0, -1, Infinity, NaN].map((time) => ({ id: 123, time })),
    ]) {
      assert.equal((await scrobble(query, request)).status, 400);
    }
    assert.equal(count, 0);
    assert.equal((await scrobble({ id: 123, action: "startPlay" }, request)).status, 200);
    assert.equal(count, 1);
  });
});
