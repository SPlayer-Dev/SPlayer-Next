import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseCueSheet, toCueTrackPath } from "./cue";

const sample = `
REM GENRE Classical
PERFORMER "Serge Prokofiev"
TITLE "Archive Recordings"
FILE "Serge Prokofiev - Archive Recordings.flac" WAVE
  TRACK 01 AUDIO
    TITLE "Piano Sonata No. 3 in A Minor, Op. 28"
    PERFORMER "Serge Prokofiev"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Piano Sonata No. 7 in B-Flat Major, Op. 83: I. Allegro inquieto"
    INDEX 01 07:14:18
  TRACK 03 AUDIO
    TITLE "Piano Sonata No. 7 in B-Flat Major, Op. 83: II. Andante caloroso"
    INDEX 01 15:41:12
`;

describe("parseCueSheet", () => {
  it("解析单文件 CUE 并生成分轨时间", () => {
    const cuePath = path.join("C:", "Music", "Archive Recordings.cue");
    const tracks = parseCueSheet(sample, cuePath, 1_200_000);

    assert.equal(tracks.length, 3);
    assert.equal(tracks[0].title, "Piano Sonata No. 3 in A Minor, Op. 28");
    assert.equal(tracks[0].artists[0].name, "Serge Prokofiev");
    assert.equal(tracks[0].album?.name, "Archive Recordings");
    assert.equal(tracks[0].track, 1);
    assert.equal(tracks[0].cueStartMs, 0);
    assert.equal(tracks[0].cueEndMs, 434_240);
    assert.equal(tracks[0].duration, 434_240);
    assert.equal(tracks[2].cueEndMs, 1_200_000);
  });

  it("生成稳定且可入库的虚拟路径", () => {
    assert.equal(toCueTrackPath("D:/a/b.cue", 7), "cue://D:/a/b.cue#track=07");
  });
});
