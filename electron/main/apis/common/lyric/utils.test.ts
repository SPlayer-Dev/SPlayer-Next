import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Track } from "@shared/types/player";
import {
  buildLyricSearchKeyword,
  getCandidateTags,
  getTTMLSearchText,
  pickBestCandidate,
  type LyricCandidate,
} from "./utils";

const track = (partial: Partial<Track>): Track => ({
  id: "local:1",
  source: "local",
  title: "同名歌曲",
  artists: [{ name: "目标歌手" }],
  duration: 180_000,
  ...partial,
});

describe("getCandidateTags", () => {
  const candidate = (partial: Partial<LyricCandidate<string>>): LyricCandidate<string> => ({
    name: "同名歌曲",
    artist: "目标歌手",
    duration: 182_000,
    extra: "1",
    ...partial,
  });

  it("歌名、歌手、时长都吻合时全部标记", () => {
    assert.deepEqual(getCandidateTags(candidate({}), track({})), ["name", "artist", "duration"]);
  });

  it("不吻合或缺少信息的项不标记", () => {
    assert.deepEqual(
      getCandidateTags(
        candidate({ name: "同名歌曲 Live", artist: "其他歌手", duration: 200_000 }),
        track({}),
      ),
      [],
    );
    assert.deepEqual(getCandidateTags(candidate({ duration: undefined }), track({})), [
      "name",
      "artist",
    ]);
  });
});

describe("pickBestCandidate", () => {
  it("拒绝同名但歌手不匹配的歌词候选", () => {
    const candidates: LyricCandidate<{ id: string }>[] = [
      {
        name: "同名歌曲",
        artist: "其他歌手",
        duration: 180_000,
        extra: { id: "wrong" },
      },
    ];

    assert.equal(pickBestCandidate(candidates, track({})), null);
  });

  it("允许多歌手曲目命中候选中的任一歌手", () => {
    const candidates: LyricCandidate<{ id: string }>[] = [
      {
        name: "同名歌曲",
        artist: "合作者",
        duration: 180_000,
        extra: { id: "hit" },
      },
    ];

    const best = pickBestCandidate(
      candidates,
      track({ artists: [{ name: "目标歌手" }, { name: "合作者" }] }),
    );

    assert.equal(best?.extra.id, "hit");
  });

  it("没有歌手元数据时仍可用歌名和时长匹配", () => {
    const candidates: LyricCandidate<{ id: string }>[] = [
      {
        name: "同名歌曲",
        artist: "平台歌手",
        duration: 181_000,
        extra: { id: "fallback" },
      },
    ];

    const best = pickBestCandidate(candidates, track({ artists: [] }));

    assert.equal(best?.extra.id, "fallback");
  });
});

describe("buildLyricSearchKeyword", () => {
  it("搜索关键词包含全部歌手", () => {
    assert.equal(
      buildLyricSearchKeyword(
        track({ title: "歌名", artists: [{ name: "歌手 A" }, { name: "歌手 B" }] }),
      ),
      "歌名 歌手 A 歌手 B",
    );
  });
});

describe("getTTMLSearchText", () => {
  const song = track({ title: "Lemon", artists: [{ name: "米津玄師" }] });

  it("默认关键词只搜歌名，手动输入的关键词原样使用", () => {
    assert.equal(getTTMLSearchText("Lemon 米津玄師", song), "Lemon");
    assert.equal(getTTMLSearchText("Lemon 其他", song), "Lemon 其他");
  });
});
