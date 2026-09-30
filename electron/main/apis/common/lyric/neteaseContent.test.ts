import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasNeteaseLyric } from "./neteaseContent";

describe("网易云歌词正文判定", () => {
  for (const content of [
    undefined,
    "",
    " \r\n ",
    "[00:00.00]暂无歌词",
    " \r\n[00:00.00]暂无歌词\r\n ",
  ]) {
    it(`将 ${JSON.stringify(content)} 视为未获取到歌词`, () => {
      assert.equal(hasNeteaseLyric(content), false);
    });
  }

  for (const content of [
    "暂无歌词",
    "[00:00.00]无歌词",
    "[00:01.00]暂无歌词",
    "[00:00.000]暂无歌词",
    "[ti:龙卷风]\n[ar:周杰伦]\n[00:00.00]暂无歌词",
    "[0,1000](0,1000,0)暂无歌词",
    "[00:00.00]纯音乐，请欣赏",
    "[00:01.00]测试歌词",
    "[1000,1000](1000,1000,0)测试歌词",
    "[00:00.00]暂无歌词\n[00:01.00]测试歌词",
    "[00:01.00]这是一首无歌词的歌",
  ]) {
    it(`保留 ${JSON.stringify(content)}`, () => {
      assert.equal(hasNeteaseLyric(content), true);
    });
  }
});
