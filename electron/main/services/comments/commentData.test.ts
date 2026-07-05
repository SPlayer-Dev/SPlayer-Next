import test from "node:test";
import assert from "node:assert/strict";

import { buildCommentSources, normalizeNeteaseCommentPage } from "./data";

test("normalizeNeteaseCommentPage maps hot and latest Netease comments to the shared shape", () => {
  const page = normalizeNeteaseCommentPage(
    {
      total: 2,
      hotComments: [
        {
          commentId: 101,
          content: "hot text",
          time: 1710000000000,
          likedCount: 9,
          ipLocation: { location: "北京" },
          user: {
            userId: 1,
            nickname: "Hot User",
            avatarUrl: "https://example.com/avatar.jpg",
          },
          beReplied: [
            {
              beRepliedCommentId: 99,
              content: "reply text",
              user: { userId: 2, nickname: "Reply User", avatarUrl: "" },
            },
          ],
        },
      ],
      comments: [
        {
          commentId: "202",
          content: "new text",
          time: 1710000001000,
          likedCount: 3,
          user: { userId: "3", nickname: "New User", avatarUrl: "" },
        },
      ],
    },
    "hot",
    2,
    20,
  );

  assert.equal(page.total, 2);
  assert.equal(page.page, 2);
  assert.equal(page.limit, 20);
  assert.deepEqual(page.list[0], {
    id: "101",
    userId: "1",
    userName: "Hot User",
    avatar: "https://example.com/avatar.jpg",
    text: "hot text",
    time: 1710000000000,
    location: "北京",
    likedCount: 9,
    reply: [
      {
        id: "99",
        userId: "2",
        userName: "Reply User",
        text: "reply text",
      },
    ],
  });
});

test("buildCommentSources includes builtin Netease and plugin sources with search and comment actions", () => {
  const sources = buildCommentSources([
    {
      manifest: { id: "plugin-a", name: "Plugin A" },
      enabled: true,
      status: {
        state: "ready",
        sources: {
          tx: { name: "QQ", actions: ["musicSearch", "musicComment"] },
          bad: { name: "No Search", actions: ["musicComment"] },
        },
      },
    },
    {
      manifest: { id: "plugin-b", name: "Plugin B" },
      enabled: false,
      status: {
        state: "ready",
        sources: {
          kg: { name: "KG", actions: ["musicSearch", "musicComment"] },
        },
      },
    },
  ]);

  assert.deepEqual(
    sources.map((source) => ({ id: source.id, name: source.name, kind: source.kind })),
    [
      { id: "builtin:netease", name: "NCM", kind: "builtin" },
      { id: "plugin:plugin-a:tx", name: "QQ", kind: "plugin" },
    ],
  );
});
