import { describe, expect, it } from "vitest";
import type { MusicCommentItem } from "@shared/types/comment";
import { appendUniqueComments, hasNextCommentPage } from "./commentPagination";

const item = (id: string): MusicCommentItem => ({ id, userName: id, text: id });

const pageOf = (list: MusicCommentItem[], total: number, limit = 20, hasMore?: boolean) => ({
  list,
  total,
  page: 1,
  limit,
  ...(hasMore === undefined ? {} : { hasMore }),
});

describe("评论追加去重", () => {
  it("对既有与新增内部都去重且保序", () => {
    const merged = appendUniqueComments(
      [item("1"), item("2")],
      [item("2"), item("3"), item("3"), item("1"), item("4")],
    );
    expect(merged.map((entry) => entry.id)).toEqual(["1", "2", "3", "4"]);
  });
});

describe("评论下一页判定", () => {
  it("显式 hasMore 优先于总数推断", () => {
    expect(hasNextCommentPage(pageOf([item("1")], 100, 20, true), 1)).toBe(true);
    expect(hasNextCommentPage(pageOf([item("1")], 100, 20, false), 1)).toBe(false);
  });

  it("满页且已加载数小于总数时继续", () => {
    const list = Array.from({ length: 20 }, (_, index) => item(String(index)));
    expect(hasNextCommentPage(pageOf(list, 40), 20)).toBe(true);
  });

  it("短页时结束", () => {
    expect(hasNextCommentPage(pageOf([item("1")], 40), 1)).toBe(false);
  });

  it("总数未知时满页继续翻页", () => {
    const list = Array.from({ length: 20 }, (_, index) => item(String(index)));
    expect(hasNextCommentPage(pageOf(list, 0), 20)).toBe(true);
  });
});
