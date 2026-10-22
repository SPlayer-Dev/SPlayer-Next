import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { streamPages } from "./pagination";

describe("流媒体完整分页", () => {
  it("服务端最多返回 50 条时仍读取 650 条并确认空页", async () => {
    const source = Array.from({ length: 650 }, (_, id) => ({ id: String(id) }));
    const offsets: number[] = [];
    const result: typeof source = [];
    for await (const page of streamPages(
      async ({ offset = 0 }) => {
        offsets.push(offset);
        return source.slice(offset, offset + 50);
      },
      (entry) => entry.id,
    ))
      result.push(...page);
    assert.equal(result.length, 650);
    assert.equal(offsets.at(-1), 650);
  });

  it("分页忽略偏移或返回重复条目时失败，不能视为完整媒体库", async () => {
    await assert.rejects(async () => {
      for await (const page of streamPages(
        async () => [{ id: "same" }],
        (item) => item.id,
      ))
        assert.equal(page.length, 1);
    }, /重复/);
  });

  it("取消后不再读取下一页", async () => {
    const controller = new AbortController();
    let requests = 0;
    await assert.rejects(async () => {
      for await (const page of streamPages(
        async () => {
          requests++;
          return [{ id: "1" }];
        },
        (item) => item.id,
        controller.signal,
      )) {
        assert.equal(page.length, 1);
        controller.abort();
      }
    }, /abort/i);
    assert.equal(requests, 1);
  });
});
