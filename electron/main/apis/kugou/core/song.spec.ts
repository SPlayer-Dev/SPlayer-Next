import { describe, expect, it, vi } from "vitest";

vi.mock("@main/store", () => ({ store: { get: (): undefined => undefined } }));

import { normalizeKGSong } from "./song";

describe("KG 歌曲归一化脏标", () => {
  it("从 trans_param.songname_suffix 识别 Explicit 并剥离后缀", () => {
    const song = normalizeKGSong({
      base: { audio_id: 962363, audio_name: "The Monster (Explicit)", album_id: "529239" },
      trans_param: { songname_suffix: "(Explicit)" },
    });

    expect(song.name).toBe("The Monster");
    expect(song.explicit).toBe(true);
  });

  it("trans_param 为脏标时不剥离不含后缀的标题", () => {
    const song = normalizeKGSong({
      base: { audio_id: 1, audio_name: "The Monster", album_id: "529239" },
      trans_param: { songname_suffix: "(Explicit)" },
    });

    expect(song.name).toBe("The Monster");
    expect(song.explicit).toBe(true);
  });

  it("无标记时不设置脏标", () => {
    const song = normalizeKGSong({ base: { audio_id: 1, audio_name: "晴天" } });

    expect(song.name).toBe("晴天");
    expect(song.explicit).toBeUndefined();
  });
});
