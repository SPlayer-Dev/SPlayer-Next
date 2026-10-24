// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { MusicCommentItem } from "@shared/types/comment";
import {
  normalizeNeteaseComment,
  normalizeNeteaseCommentPage,
  normalizeQQMusicCommentPage,
  scanCreatorComments,
} from "./data";

const comment = (overrides: Record<string, unknown> = {}) => ({
  commentId: 1,
  content: "内容",
  user: { userId: 9, nickname: "听众" },
  ...overrides,
});

describe("网易云评论归一化", () => {
  it("top-level more 决定 hasMore", () => {
    const page = normalizeNeteaseCommentPage(
      { comments: [comment()], total: 100, more: true },
      "new",
      1,
      20,
    );
    expect(page.hasMore).toBe(true);
  });

  it("回落到 data.hasMore", () => {
    const page = normalizeNeteaseCommentPage(
      { data: { comments: [comment()], hasMore: true } },
      "new",
      1,
      20,
    );
    expect(page.hasMore).toBe(true);
  });

  it("两者都缺失时 hasMore 为 undefined", () => {
    const page = normalizeNeteaseCommentPage({ comments: [comment()] }, "new", 1, 20);
    expect(page.hasMore).toBeUndefined();
  });

  it("total 缺失时回退 0", () => {
    const page = normalizeNeteaseCommentPage({ comments: [comment()] }, "new", 1, 20);
    expect(page.total).toBe(0);
  });

  it("回复缺少自身 id 时用 fallbackId 生成互不相同的 id", () => {
    const item = normalizeNeteaseComment({
      commentId: 7,
      content: "父评论",
      user: { userId: 1, nickname: "甲" },
      beReplied: [
        { content: "回复一", user: { userId: 2, nickname: "乙" } },
        { content: "回复二", user: { userId: 3, nickname: "丙" } },
      ],
    });
    const ids = item?.reply?.map((reply) => reply.id) ?? [];
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("QQ 音乐评论归一化", () => {
  it("透传 hasMore 并在为真时保留空游标", () => {
    const page = normalizeQQMusicCommentPage(
      { comments: [{ CmId: "1", Content: "内容", Nick: "听众" }], hasMore: true },
      1,
      20,
    );
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe("");
  });

  it("hasMore 为假时省略游标", () => {
    const page = normalizeQQMusicCommentPage(
      { comments: [{ CmId: "1", Content: "内容", Nick: "听众" }], hasMore: false },
      1,
      20,
    );
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeUndefined();
  });
});

describe("主创评论扫描", () => {
  const accountMap = new Map([["9", "主创名"]]);

  it("命中顶层评论并写入 creatorName", () => {
    const items: MusicCommentItem[] = [{ id: "1", userId: "9", userName: "a", text: "t" }];
    const hits = scanCreatorComments(items, accountMap);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.creatorName).toBe("主创名");
  });

  it("主创在粉丝评论下的回复同样计入", () => {
    const items: MusicCommentItem[] = [
      {
        id: "1",
        userId: "100",
        userName: "粉丝",
        text: "问",
        reply: [{ id: "2", userId: "9", userName: "主创", text: "答" }],
      },
    ];
    const hits = scanCreatorComments(items, accountMap);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe("2");
    expect(hits[0]?.creatorName).toBe("主创名");
  });

  it("顶层主创评论下的其他主创回复也会返回", () => {
    const items: MusicCommentItem[] = [
      {
        id: "1",
        userId: "9",
        userName: "主创甲",
        text: "顶层",
        reply: [{ id: "2", userId: "10", userName: "主创乙", text: "回复" }],
      },
    ];
    const hits = scanCreatorComments(
      items,
      new Map([
        ["9", "主创甲"],
        ["10", "主创乙"],
      ]),
    );
    expect(hits.map((hit) => hit.id)).toEqual(["1", "2"]);
    expect(hits.map((hit) => hit.creatorName)).toEqual(["主创甲", "主创乙"]);
  });

  it("歌手名为空时 creatorName 为空串", () => {
    const items: MusicCommentItem[] = [{ id: "1", userId: "9", userName: "a", text: "t" }];
    const hits = scanCreatorComments(items, new Map([["9", ""]]));
    expect(hits[0]?.creatorName).toBe("");
  });

  it("账号映射为空时返回空数组", () => {
    const items: MusicCommentItem[] = [{ id: "1", userId: "9", userName: "a", text: "t" }];
    expect(scanCreatorComments(items, new Map())).toEqual([]);
  });
});
